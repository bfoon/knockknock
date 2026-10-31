"""
kura/kura_form.py — Kura Form workbooks: write them, read them, check them.

A "Kura Form" is the friendly Excel layout the form builder imports and
exports (templates/kura/builder.html → buildWorkbook / parseWorkbook): one row
per question in a "Questions" sheet, plain-English types ("Choose one"),
inline choices ("yes = Yes"), readable logic ("consent = yes and age >= 18"),
plus optional "Choices", "Indicators" and "Form" sheets.

This module is what lets Foon:

  * WRITE a polished template or a drafted questionnaire as a Kura Form —
    same sheets, columns and order as the builder's own export, plus type
    dropdowns and column help, so it always re-imports.
  * READ a workbook exactly the way the builder will (a line-by-line port of
    parseWorkbook), but recording every problem with its sheet, row and cell.
  * CHECK it far more strictly than the importer does. The importer quietly
    turns an unknown type into Short text, drops a condition it can't read
    and — via prepareQuestions — re-points skip logic at a renamed duplicate.
    The checker catches all of that, plus formulas, regexes, cascades,
    repeats, choice values and indicators, before a survey is created.
  * FIX what can be fixed safely (typos in types, duplicate names, swapped
    min/max, choice labels used as values…) and hand back either the user's
    own workbook marked up with coloured, commented cells, or a clean fixed
    Kura Form.
  * CONVERT a Kobo / ODK XLSForm (survey + choices sheets) into a Kura Form.
"""

from __future__ import annotations

import ast
import copy
import csv
import difflib
import io
import re
from dataclasses import dataclass, field, asdict

# ─────────────────────────────────────────────────────────────────────
#  The template, mirrored from builder.html
# ─────────────────────────────────────────────────────────────────────

FRIENDLY_TYPES = {
    "section": "Section header", "note": "Note / disclaimer", "text": "Short text",
    "long_text": "Paragraph", "integer": "Whole number", "decimal": "Decimal number",
    "select_one": "Choose one", "select_multiple": "Choose many", "rank": "Rank options",
    "likert": "Likert scale", "rating": "Rating", "date": "Date", "time": "Time",
    "datetime": "Date & time", "gps": "GPS location", "mapper": "Map (track / area / draw)", "photo": "Photo",
    "barcode": "Barcode / QR", "calculate": "Calculated (hidden)", "repeat": "Repeat group",
}
CHOICE_TYPES = ("select_one", "select_multiple", "rank", "likert")
TYPE_IDS = set(FRIENDLY_TYPES) | {"matrix", "audio", "signature"}
NUMERIC_TYPES = ("integer", "decimal", "rating", "calculate")
DISPLAY_TYPES = ("note", "section")


def _type_aliases():
    m = {}
    for t, label in FRIENDLY_TYPES.items():
        m[t] = t
        m[label.lower()] = t

    def add(t, names):
        for n in names:
            m[n] = t
    add("note", ["disclaimer", "introduction", "info", "display", "read only", "message"])
    add("section", ["section", "heading", "header", "group header", "section title"])
    add("text", ["string", "short answer", "text"])
    add("long_text", ["long text", "textarea", "comment", "open text"])
    add("integer", ["number", "whole number", "int"])
    add("decimal", ["float", "currency", "number (decimal)"])
    add("select_one", ["select one", "single choice", "radio", "dropdown", "choice", "choose 1"])
    add("select_multiple", ["select multiple", "multiple choice", "checkbox", "checkboxes", "multi select",
                            "multiselect", "choose several"])
    add("rank", ["ranking", "rank options"])
    add("likert", ["agreement scale", "likert"])
    add("rating", ["stars", "star rating", "score"])
    add("datetime", ["date and time", "date time"])
    add("gps", ["location", "geopoint", "coordinates", "gps point"])
    add("mapper", ["map", "geotrace", "geoshape", "trace", "track", "route", "area", "polygon", "geofence",
                   "boundary", "plot boundary"])
    add("photo", ["image", "picture", "camera"])
    add("barcode", ["qr", "qr code", "scan", "barcode"])
    add("calculate", ["calculated", "calculation", "formula", "hidden calculation"])
    add("repeat", ["begin repeat", "roster", "group (repeat)", "repeating group"])
    return m


TYPE_ALIASES = _type_aliases()
END_REPEAT = {"end repeat", "end group", "end", "end of repeat", "end roster"}

KF_HEADERS = ["Type", "Question", "Name (data column)", "Required", "Choices", "Hint / help", "Show when",
              "Filter choices by", "Min", "Max", "Pattern (regex)", "Must be true (rule)", "Warn when false",
              "Warning message", "Error message", "Calculation", "Indicator"]
KF_KEYS = ["type", "label", "name", "required", "choices", "hint", "show", "cascade", "min", "max", "regex",
           "expr", "warn_expr", "warn_message", "message", "calc", "indicator"]
KF_WIDTHS = [18, 46, 18, 9, 30, 32, 28, 16, 7, 7, 18, 22, 20, 24, 24, 18, 12]
KF_HEADER_MAP = {
    "type": "type",
    "question": "label", "label": "label", "questiontext": "label",
    "name": "name", "namedatacolumn": "name", "machinename": "name", "datacolumn": "name", "column": "name",
    "required": "required",
    "choices": "choices", "options": "choices", "answers": "choices",
    "hint": "hint", "hinthelp": "hint", "help": "hint", "helptext": "hint",
    "showwhen": "show", "relevant": "show", "condition": "show", "skiplogic": "show",
    "filterchoicesby": "cascade", "cascade": "cascade", "parentquestion": "cascade",
    "min": "min", "minimum": "min", "max": "max", "maximum": "max",
    "pattern": "regex", "patternregex": "regex", "regex": "regex",
    "mustbetrue": "expr", "mustbetruerule": "expr", "rule": "expr", "constraint": "expr",
    "warnwhenfalse": "warn_expr", "warnwhen": "warn_expr", "warningrule": "warn_expr",
    "warningmessage": "warn_message",
    "errormessage": "message", "message": "message",
    "calculation": "calc", "formula": "calc", "calc": "calc",
    "indicator": "indicator", "indicatorcode": "indicator",
}
COLUMN_HELP = {
    "type": "Plain names: Choose one, Choose many, Short text, Paragraph, Whole number, Decimal number, Rating, "
            "Likert scale, Rank options, Date, Time, Date & time, GPS location, Photo, Barcode / QR, Note / disclaimer, "
            "Section header, Calculated (hidden), Repeat group, End repeat.",
    "label": "The wording respondents see.",
    "name": "The data column. Leave blank and Kura makes one from the question. Letters, numbers and _ only.",
    "required": "Yes to make the question compulsory.",
    "choices": "One per line (Alt+Enter) or separated by ;  — Yes, or value = Label (y = Yes). "
               "Long or cascading lists go in the Choices sheet.",
    "hint": "Help text under the question. For a Note, this is the body text.",
    "show": "When to show it: consent = yes · age >= 18 · symptoms has selected fever · phone is answered. "
            "Join with and / or (one kind per cell). Only earlier questions.",
    "cascade": "Name of the question whose answer filters these choices (use the Choices sheet's Parent value).",
    "min": "Smallest number allowed (Repeat group: fewest items).",
    "max": "Largest number allowed (Repeat group: most items).",
    "regex": "A pattern text answers must match, e.g. ^[0-9]{7}$ for a 7-digit phone number.",
    "expr": "A rule that must be true, using question names and value for this answer, e.g. value <= age.",
    "warn_expr": "Like Must be true, but only warns.",
    "warn_message": "Shown when Warn when false fails.",
    "message": "Shown when the answer breaks Min/Max, Pattern or Must be true.",
    "calc": "Calculated (hidden): a formula like weight / ((height/100)^2). Repeat group: the number question "
            "that sets how many times it repeats.",
    "indicator": "Code of an indicator from the Indicators sheet.",
}
README = [
    "KURA FORM — fill this workbook, then Import it in the form builder.", "",
    "HOW IT WORKS",
    "• Each row of the Questions sheet is one question, top to bottom.",
    "• Type: use plain names — Choose one, Choose many, Short text, Paragraph,",
    "  Whole number, Decimal number, Rating, Likert scale, Rank options, Date,",
    "  Time, Date & time, GPS location, Photo, Barcode / QR, Note / disclaimer,",
    "  Section header, Calculated (hidden), Repeat group, End repeat.",
    "• Question: the wording respondents see. Name is the data column — leave it",
    "  blank and Kura makes one from the question text.",
    "• Choices: one per line (Alt+Enter) or separated by ; — either just the label",
    "  (Yes) or value = Label (y = Yes). Long or cascading lists go in the",
    "  Choices sheet instead, one row per option, keyed by the question Name.",
    "• Show when: write conditions like  consent = yes  ·  age >= 18  ·",
    "  district ≠ other  ·  symptoms has selected fever  ·  phone is answered.",
    "  Join several with and / or (one kind per cell).",
    "• Min / Max, Pattern (regex), Must be true (rule), Warn when false +",
    "  Warning message, Error message: optional answer checks.",
    "• Repeat group starts a repeating block (household members…); every row",
    "  until End repeat belongs to it. Its Calculation cell may name a number",
    "  question that sets how many times it repeats.",
    "• Note / disclaimer shows text only (introduction, consent script) — the",
    "  Question cell is the heading, Hint / help is the body. No answer is stored.",
    "• Indicators sheet: your programme indicators (code, name, target); put the",
    "  code in a question's Indicator cell to link them.", "",
    "Geofence zones, choice lookups, scoring and answer shuffling are managed",
    "in the builder itself and are kept when you import with Append.", "",
    "CHECK BEFORE YOU IMPORT",
    "• Drop this file on Foon (the robot in Kura's corner) and it checks every",
    "  cell, explains problems, fixes what it safely can, then creates the survey.",
]
STARTER = [
    {"name": "intro", "type": "note", "label": "About this survey",
     "hint": "Thank you for taking part. Your answers are confidential and you may stop at any time.",
     "required": False, "relevant": None, "validate": {}},
    {"name": "consent", "type": "select_one", "label": "Do you agree to participate?", "hint": "", "required": True,
     "relevant": None, "validate": {"message": "Consent is required before continuing."},
     "choices": [{"value": "yes", "label": "Yes, I agree"}, {"value": "no", "label": "No"}]},
    {"name": "age", "type": "integer", "label": "How old are you?", "hint": "In completed years", "required": True,
     "relevant": {"op": "and", "rules": [{"q": "consent", "cmp": "eq", "value": "yes"}]},
     "validate": {"min": 0, "max": 120, "message": "Age must be between 0 and 120."}},
    {"name": "members", "type": "repeat", "label": "Household members", "hint": "", "required": False,
     "relevant": None, "validate": {}, "repeat": {"min": None, "max": None, "item_label": "Item ${index}", "count_expr": ""},
     "children": [{"name": "mname", "type": "text", "label": "Member's name", "hint": "", "required": True,
                   "relevant": None, "validate": {}}]},
]
STARTER_INDICATORS = [{"id": "ind1", "code": "IND-1", "name": "Example indicator", "target": 100}]

CMP_TO_TEXT = {"eq": "=", "ne": "≠", "gt": ">", "gte": ">=", "lt": "<", "lte": "<=", "contains": "contains",
               "not_contains": "doesn't contain", "selected": "has selected", "not_selected": "hasn't selected",
               "answered": "is answered", "not_answered": "is blank", "between": "between", "matches": "matches"}

MAX_BYTES = 5 * 1024 * 1024


class FormFileError(Exception):
    """The file can't be read at all (not a workbook, no Questions sheet…)."""


# ─────────────────────────────────────────────────────────────────────
#  Small helpers (same behaviour as the builder's JS)
# ─────────────────────────────────────────────────────────────────────

def norm_key(s):
    return re.sub(r"[^a-z]", "", str(s or "").lower())


def sanitize_name(raw):
    s = re.sub(r"[^a-z0-9_]+", "_", str(raw or "").lower()).strip("_")[:30]
    if re.match(r"^\d", s):
        s = "q_" + s
    return s


def _num(v):
    if v in (None, ""):
        return None
    try:
        n = float(str(v).strip())
    except ValueError:
        return None
    if n != n or n in (float("inf"), float("-inf")):
        return None
    return int(n) if n.is_integer() else n


def _truthy(v):
    return bool(re.fullmatch(r"(yes|y|true|1|required|✓|x)", str(v).strip(), re.I))


def _cellstr(v):
    """A cell as the builder's String(cell) would see it."""
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    if hasattr(v, "isoformat"):
        return v.isoformat()[:19].replace("T", " ").replace(" 00:00:00", "")
    return str(v)


def col_letter(ci):
    from openpyxl.utils import get_column_letter
    return get_column_letter(ci + 1)


def show_when_text(rel):
    if not isinstance(rel, dict) or not rel.get("rules"):
        return ""
    if any(isinstance(r, dict) and isinstance(r.get("rules"), list) for r in rel["rules"]):
        return "(complex logic — edit in the builder)"
    parts = []
    for r in rel["rules"]:
        if r.get("cmp") == "answered":
            parts.append(f"{r['q']} is answered")
        elif r.get("cmp") == "not_answered":
            parts.append(f"{r['q']} is blank")
        else:
            v = ", ".join(map(str, r["value"])) if isinstance(r.get("value"), list) else \
                ("" if r.get("value") is None else r["value"])
            parts.append(f"{r['q']} {CMP_TO_TEXT.get(r.get('cmp'), '=')} {v}")
    return (" or " if rel.get("op") == "or" else " and ").join(parts)


_RULE_PATTERNS = [
    (re.compile(r"^([A-Za-z0-9_]+)\s+is\s+answered$", re.I), lambda m: {"q": m[1], "cmp": "answered", "value": ""}),
    (re.compile(r"^([A-Za-z0-9_]+)\s+is\s+(blank|empty|not\s+answered)$", re.I),
     lambda m: {"q": m[1], "cmp": "not_answered", "value": ""}),
    (re.compile(r"^([A-Za-z0-9_]+)\s+between\s+(.+)$", re.I),
     lambda m: {"q": m[1], "cmp": "between", "value": ",".join(re.split(r"\s*(?:,|and)\s*", m[2], flags=re.I)[:2])}),
    (re.compile(r"^([A-Za-z0-9_]+)\s+matches\s+(.+)$", re.I), lambda m: {"q": m[1], "cmp": "matches", "value": m[2].strip()}),
    (re.compile(r"^([A-Za-z0-9_]+)\s+hasn'?t\s+selected\s+(.+)$", re.I),
     lambda m: {"q": m[1], "cmp": "not_selected", "value": m[2].strip()}),
    (re.compile(r"^([A-Za-z0-9_]+)\s+has\s+selected\s+(.+)$", re.I),
     lambda m: {"q": m[1], "cmp": "selected", "value": m[2].strip()}),
    (re.compile(r"^([A-Za-z0-9_]+)\s+doesn'?t\s+contain\s+(.+)$", re.I),
     lambda m: {"q": m[1], "cmp": "not_contains", "value": m[2].strip()}),
    (re.compile(r"^([A-Za-z0-9_]+)\s+contains\s+(.+)$", re.I), lambda m: {"q": m[1], "cmp": "contains", "value": m[2].strip()}),
]
_CMP_RE = re.compile(r"^([A-Za-z0-9_]+)\s*(>=|<=|==|!=|≠|=|>|<)\s*(.+)$")
_CMP_OPS = {"=": "eq", "==": "eq", "!=": "ne", "≠": "ne", ">": "gt", ">=": "gte", "<": "lt", "<=": "lte"}


def parse_rule_text(p):
    for rx, make in _RULE_PATTERNS:
        m = rx.match(p)
        if m:
            return make(m)
    m = _CMP_RE.match(p)
    if m:
        return {"q": m[1], "cmp": _CMP_OPS[m[2]], "value": re.sub(r"^[\"']|[\"']$", "", m[3].strip())}
    return None


def parse_show_when(text):
    """Returns (relevant_or_None, unreadable_parts, mixed_and_or)."""
    s = str(text or "").strip()
    if not s or s[0] == "(":
        return None, [], False
    has_or, has_and = bool(re.search(r" or ", s, re.I)), bool(re.search(r" and ", s, re.I))
    use_or = has_or and not has_and
    parts = re.split(r" or " if use_or else r" and ", s, flags=re.I)
    rules, bad = [], []
    for p in parts:
        r = parse_rule_text(p.strip())
        if r:
            rules.append(r)
        else:
            bad.append(p.strip())
    return ({"op": "or" if use_or else "and", "rules": rules} if rules else None), bad, (has_or and has_and)


def choices_cell_text(q):
    cs = q.get("choices") or []
    if not cs:
        return ""
    if any(c.get("parent") not in (None, "") for c in cs) or any(c.get("zones") for c in cs):
        return "(see the Choices sheet)"
    return "\n".join(f"{c['value']} = {c.get('label') or c['value']}" for c in cs)


def parse_choices_cell(cell):
    s = str(cell or "").strip()
    if not s or s[0] == "(":
        return []
    items = [x.strip() for x in re.split(r"\r?\n|;", s) if x.strip()]
    used, out = set(), []
    for i, item in enumerate(items):
        eq = item.find("=")
        if eq > 0:
            value, label = item[:eq].strip(), item[eq + 1:].strip()
        else:
            label, value = item, sanitize_name(item) or f"option_{i + 1}"
        base = str(value) or f"option_{i + 1}"
        v, n = base, 2
        while v in used:
            v = f"{base}_{n}"
            n += 1
        used.add(v)
        out.append({"value": v, "label": label or v})
    return out


def walk_rules(rel, fn):
    if not isinstance(rel, dict):
        return
    for r in rel.get("rules") or []:
        if isinstance(r, dict) and isinstance(r.get("rules"), list):
            walk_rules(r, fn)
        elif isinstance(r, dict):
            fn(r)


def iter_questions(questions):
    """(question, parent_or_None) in form order."""
    for q in questions:
        yield q, None
        for c in q.get("children") or []:
            yield c, q


# ─────────────────────────────────────────────────────────────────────
#  Issues
# ─────────────────────────────────────────────────────────────────────

LEVELS = ("error", "warning", "info", "fixed")
CATEGORIES = {
    "structure": "Structure", "question": "Questions", "choices": "Choices",
    "logic": "Skip logic", "calc": "Rules & formulas", "indicator": "Indicators",
}


@dataclass
class Issue:
    level: str
    cat: str
    msg: str
    sheet: str = "Questions"
    row: int | None = None
    key: str | None = None        # column key (type, label, show…)
    cell: str | None = None       # "G14"
    fix: str = ""                  # suggestion
    fixable: bool = False
    q: str | None = None           # question name
    _apply: dict | None = field(default=None, repr=False)

    def public(self):
        d = asdict(self)
        d.pop("_apply", None)
        return d


# ─────────────────────────────────────────────────────────────────────
#  Reading a workbook (port of parseWorkbook, with locations)
# ─────────────────────────────────────────────────────────────────────

@dataclass
class Book:
    names: list
    sheets: dict          # name → list of rows (list of str)
    kind: str             # xlsx | csv

    def find(self, want):
        for n in self.names:
            k = norm_key(n)
            if k == want or want in k:
                return n
        return None


def load_book(data: bytes, filename="") -> Book:
    if not data:
        raise FormFileError("The file is empty.")
    if len(data) > MAX_BYTES:
        raise FormFileError("That file is larger than 5 MB — a questionnaire workbook should be much smaller.")
    low = (filename or "").lower()
    if low.endswith(".csv"):
        text = data.decode("utf-8-sig", errors="replace")
        rows = [[c for c in r] for r in csv.reader(io.StringIO(text))]
        return Book(["Questions"], {"Questions": rows}, "csv")
    if low.endswith(".xls") and not low.endswith(".xlsx"):
        raise FormFileError("That's an old .xls file. Open it in Excel and save it as .xlsx (Excel Workbook), then try again.")
    from openpyxl import load_workbook
    try:
        wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception:
        raise FormFileError("That file could not be read as an Excel workbook (.xlsx). Save it from Excel or "
                            "Google Sheets as .xlsx and try again.")
    sheets, names = {}, []
    for ws in wb.worksheets:
        rows = []
        for r in ws.iter_rows(min_row=1, max_col=60, values_only=True):
            rows.append([_cellstr(v) for v in r])
            if len(rows) > 3000:
                break
        while rows and not any(c.strip() for c in rows[-1]):
            rows.pop()
        sheets[ws.title] = rows
        names.append(ws.title)
    wb.close()
    return Book(names, sheets, "xlsx")


def _header_index(rows, must_have):
    for i in range(min(len(rows), 10)):
        cols = {}
        for ci, c in enumerate(rows[i] or []):
            mapped = KF_HEADER_MAP.get(norm_key(c))
            if mapped and mapped not in cols:
                cols[mapped] = ci
        if all(k in cols for k in must_have):
            return i, cols
    return None


def is_xlsform(book: Book):
    n = next((x for x in book.names if norm_key(x) == "survey"), None)
    if not n:
        return False
    for row in book.sheets[n][:5]:
        keys = {norm_key(c) for c in row}
        if "type" in keys and "name" in keys:
            return True
    return False


def parse_book(book: Book):
    """Returns (form, issues). form = {title, description, questions, indicators,
    source:{sheet, header_row, cols, letters}}; questions carry _row/_raw."""
    issues = []
    qsheet = book.find("questions")
    if not qsheet:
        if is_xlsform(book):
            return parse_xlsform(book)
        raise FormFileError("There's no “Questions” sheet. A Kura Form needs a sheet called Questions — ask me for "
                            "the template and I'll give you one.")
    rows = book.sheets[qsheet]
    head = _header_index(rows, ["type", "label"])
    if not head:
        raise FormFileError("The Questions sheet needs at least “Type” and “Question” column headings in its first "
                            "10 rows.")
    hrow, cols = head
    letters = {k: col_letter(ci) for k, ci in cols.items()}
    seen_norm = {}
    for ci, c in enumerate(rows[hrow]):
        k = norm_key(c)
        if not k:
            continue
        mapped = KF_HEADER_MAP.get(k)
        if not mapped:
            issues.append(Issue("info", "structure", f"Column “{c}” isn't part of a Kura Form, so it's ignored.",
                                sheet=qsheet, row=hrow + 1, cell=f"{col_letter(ci)}{hrow + 1}"))
        elif mapped in seen_norm:
            issues.append(Issue("warning", "structure",
                                f"There are two “{c}” columns — only the first ({col_letter(cols[mapped])}) is read.",
                                sheet=qsheet, row=hrow + 1, cell=f"{col_letter(ci)}{hrow + 1}"))
        seen_norm[mapped] = True

    def cell(r, k):
        ci = cols.get(k)
        return "" if ci is None or ci >= len(r) else str(r[ci] if r[ci] is not None else "").strip()

    def where(rowno, k):
        return f"{letters[k]}{rowno}" if k in letters else None

    questions, open_repeat, open_row = [], None, None
    for i in range(hrow + 1, len(rows)):
        r = rows[i] or []
        rowno = i + 1
        type_raw, label = cell(r, "type"), cell(r, "label")
        if not type_raw and not label:
            continue
        tkey = type_raw.lower().strip()
        if tkey in END_REPEAT:
            if open_repeat is None:
                issues.append(Issue("warning", "structure", "“End repeat” without a Repeat group above it — ignored.",
                                    sheet=qsheet, row=rowno, key="type", cell=where(rowno, "type")))
            open_repeat = None
            continue
        qtype = TYPE_ALIASES.get(tkey)
        raw = {k: cell(r, k) for k in cols}
        if not qtype:
            qtype = "text"
            if type_raw:
                guess = difflib.get_close_matches(tkey, list(TYPE_ALIASES), n=1, cutoff=0.6)
                g = TYPE_ALIASES[guess[0]] if guess else None
                issues.append(Issue(
                    "error", "question",
                    f"“{type_raw}” isn't a question type — the builder would quietly make it Short text.",
                    sheet=qsheet, row=rowno, key="type", cell=where(rowno, "type"),
                    fix=f"Did you mean “{FRIENDLY_TYPES[g]}”?" if g else "Pick a type from the dropdown.",
                    fixable=bool(g), _apply={"field": "type", "value": g} if g else None))
            else:
                issues.append(Issue("warning", "question", "No type given — this row becomes Short text.",
                                    sheet=qsheet, row=rowno, key="type", cell=where(rowno, "type"),
                                    fix="Choose a type for it."))
        raw_name = cell(r, "name")
        q = {
            "name": sanitize_name(raw_name or label or qtype),
            "type": qtype,
            "label": label or FRIENDLY_TYPES.get(qtype, qtype),
            "hint": cell(r, "hint"),
            "required": False if qtype in DISPLAY_TYPES else _truthy(cell(r, "required")),
            "relevant": None,
            "validate": {},
            "_row": rowno, "_raw": raw, "_raw_name": raw_name,
        }
        rel, bad, mixed = parse_show_when(cell(r, "show"))
        q["relevant"] = rel
        q["_show_bad"], q["_show_mixed"] = bad, mixed
        v = q["validate"]
        if qtype != "repeat":
            mn, mx = _num(cell(r, "min")), _num(cell(r, "max"))
            if mn is not None:
                v["min"] = mn
            if mx is not None:
                v["max"] = mx
        for k in ("regex", "expr", "warn_expr", "warn_message", "message"):
            val = cell(r, k)
            if val:
                v[k] = val
        if qtype in CHOICE_TYPES:
            q["choices"] = parse_choices_cell(cell(r, "choices"))
        casc = cell(r, "cascade")
        if casc:
            q["cascade"] = {"parent": sanitize_name(casc)}
        calc = cell(r, "calc")
        if qtype == "calculate":
            q["calc"] = calc
        if qtype == "repeat":
            q["children"] = []
            q["repeat"] = {"min": _num(cell(r, "min")), "max": _num(cell(r, "max")), "item_label": "Item ${index}"}
            if calc:
                q["repeat"]["count_expr"] = calc
        ind = cell(r, "indicator")
        if ind:
            q["_indicator"] = ind

        if qtype == "repeat":
            if open_repeat is not None:
                issues.append(Issue("warning", "structure",
                                    f"A Repeat group starts inside “{open_repeat['label']}” — repeats can't be nested, so "
                                    "the first one ends here.", sheet=qsheet, row=rowno, key="type", cell=where(rowno, "type"),
                                    fix="Add an End repeat row before it."))
            questions.append(q)
            open_repeat, open_row = q, rowno
        elif open_repeat is not None:
            if qtype == "section":
                questions.append(q)
            else:
                open_repeat["children"].append(q)
        else:
            questions.append(q)
    if open_repeat is not None and open_repeat["children"]:
        issues.append(Issue("info", "structure",
                            f"The Repeat group “{open_repeat['label']}” is never closed, so all {len(open_repeat['children'])} "
                            "question(s) after it belong to it.", sheet=qsheet, row=open_row, key="type",
                            cell=where(open_row, "type"), fix="Add an “End repeat” row where the repeat should stop.",
                            fixable=True, q=open_repeat["name"], _apply={"field": "_close_repeat"}))
    if not questions:
        raise FormFileError("The Questions sheet has headings but no questions under them.")

    # Choices sheet
    choice_rows = {}
    csheet = book.find("choices")
    if csheet:
        crows = book.sheets[csheet]
        h = None
        for i in range(min(len(crows), 5)):
            ccols = {}
            for ci, c in enumerate(crows[i] or []):
                k = norm_key(c)
                if k in ("question", "questionname", "name") and "q" not in ccols:
                    ccols["q"] = ci
                elif k == "value" and "v" not in ccols:
                    ccols["v"] = ci
                elif k == "label" and "l" not in ccols:
                    ccols["l"] = ci
                elif k in ("parentvalue", "parent") and "p" not in ccols:
                    ccols["p"] = ci
                elif k == "zones" and "z" not in ccols:
                    ccols["z"] = ci
            if "q" in ccols and "v" in ccols:
                h = (i, ccols)
                break
        if h is None:
            issues.append(Issue("warning", "choices", "The Choices sheet needs “Question name” and “Value” headings — "
                                "it was skipped.", sheet=csheet, row=1))
        else:
            hi, cc = h

            def g(r, k):
                ci = cc.get(k)
                return "" if ci is None or ci >= len(r) else str(r[ci] or "").strip()
            for i in range(hi + 1, len(crows)):
                r = crows[i] or []
                qn, val = sanitize_name(g(r, "q")), g(r, "v")
                if not qn or not val:
                    if qn or val:
                        issues.append(Issue("warning", "choices", "A Choices row needs both a question name and a value — skipped.",
                                            sheet=csheet, row=i + 1))
                    continue
                c = {"value": val, "label": g(r, "l") or val}
                if g(r, "p"):
                    c["parent"] = g(r, "p")
                if g(r, "z"):
                    c["zones"] = [z.strip() for z in g(r, "z").split(",") if z.strip()]
                c["_row"] = i + 1
                choice_rows.setdefault(qn, []).append(c)
            for q, _p in iter_questions(questions):
                if q["type"] in CHOICE_TYPES and not q.get("choices") and choice_rows.get(q["name"]):
                    q["choices"] = choice_rows[q["name"]]
                    q["_choices_sheet"] = True
            names = {q["name"] for q, _p in iter_questions(questions)}
            for qn, lst in choice_rows.items():
                if qn not in names:
                    issues.append(Issue("warning", "choices",
                                        f"{len(lst)} choice row(s) belong to “{qn}”, which isn't a question name in this file.",
                                        sheet=csheet, row=lst[0]["_row"],
                                        fix=_did_you_mean(qn, names)))

    # Indicators sheet
    indicators = []
    isheet = book.find("indicators")
    if isheet:
        irows = book.sheets[isheet]
        h = None
        for i in range(min(len(irows), 5)):
            ic = {}
            for ci, c in enumerate(irows[i] or []):
                k = norm_key(c)
                if k == "code" and "c" not in ic:
                    ic["c"] = ci
                elif k == "name" and "n" not in ic:
                    ic["n"] = ci
                elif k == "target" and "t" not in ic:
                    ic["t"] = ci
            if "c" in ic or "n" in ic:
                h = (i, ic)
                break
        if h:
            hi, ic = h
            for i in range(hi + 1, len(irows)):
                r = irows[i] or []
                gv = lambda k: "" if ic.get(k) is None or ic[k] >= len(r) else str(r[ic[k]] or "").strip()  # noqa: E731
                code, name = gv("c"), gv("n")
                if not code and not name:
                    continue
                t = _num(gv("t"))
                indicators.append({"id": f"ind{len(indicators) + 1}", "code": code, "name": name or code, "target": t})
    lookup = {}
    for d in indicators:
        if d["code"]:
            lookup[d["code"].lower()] = d["id"]
        if d["name"]:
            lookup[d["name"].lower()] = d["id"]
    for q, _p in iter_questions(questions):
        ref = q.pop("_indicator", None)
        if ref:
            if ref.lower() in lookup:
                q["indicator"] = lookup[ref.lower()]
            else:
                issues.append(Issue("warning", "indicator",
                                    f"Indicator “{ref}” on “{q['label']}” isn't in the Indicators sheet — the link would be skipped.",
                                    sheet=qsheet, row=q["_row"], key="indicator", cell=where(q["_row"], "indicator"),
                                    q=q["name"], fix=_did_you_mean(ref, [d["code"] for d in indicators if d["code"]])))

    title = description = ""
    fsheet = book.find("form")
    if fsheet:
        for r in book.sheets[fsheet]:
            k = norm_key(r[0] if r else "")
            if k == "title":
                title = str(r[1] if len(r) > 1 else "").strip()
            elif k == "description":
                description = str(r[1] if len(r) > 1 else "").strip()
    form = {"title": title, "description": description, "questions": questions, "indicators": indicators,
            "source": {"sheet": qsheet, "header_row": hrow + 1, "letters": letters, "kind": book.kind,
                       "choices_sheet": csheet}}
    return form, issues


def _did_you_mean(word, options):
    options = [o for o in options if o]
    m = difflib.get_close_matches(str(word).lower(), [o.lower() for o in options], n=1, cutoff=0.6)
    if not m:
        return ""
    real = next(o for o in options if o.lower() == m[0])
    return f"Did you mean “{real}”?"


# ─────────────────────────────────────────────────────────────────────
#  Checking
# ─────────────────────────────────────────────────────────────────────

def _allowed_funcs():
    try:
        from .logic import _FUNCS
        return set(_FUNCS)
    except Exception:  # pragma: no cover
        return {"abs", "min", "max", "round", "int", "float", "pow", "sqrt", "coalesce", "if_", "count",
                "sum_of", "avg_of", "min_of", "max_of", "count_if"}


_OK_NODES = (ast.Expression, ast.Constant, ast.Name, ast.Load, ast.BinOp, ast.UnaryOp, ast.Compare, ast.BoolOp,
             ast.Call, ast.Add, ast.Sub, ast.Mult, ast.Div, ast.FloorDiv, ast.Mod, ast.Pow, ast.USub, ast.UAdd,
             ast.Eq, ast.NotEq, ast.Gt, ast.GtE, ast.Lt, ast.LtE, ast.And, ast.Or)


def check_expression(expr, known, allow_value=False):
    """Returns (problems:list[(level,msg,fix,fixed_expr_or_None)], referenced names)."""
    out, refs = [], set()
    src = str(expr).strip()
    fixed = None
    if "${" in src:
        fixed = re.sub(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}", r"\1", src)
        out.append(("error", "uses ${name} (Kobo/ODK style) — Kura formulas use the bare question name.",
                    f"Write it as: {fixed}", fixed))
        src = fixed
    if re.search(r"\bif\s*\(", src):
        better = re.sub(r"\bif\s*\(", "if_(", src)
        out.append(("error", "uses if(…) — in Kura formulas it's written if_(condition, a, b).", f"Write it as: {better}", better))
        src = better
    py = src.replace("^", "**")
    py_eq = re.sub(r"(?<![<>!=])=(?!=)", "==", py)
    try:
        tree = ast.parse(py, mode="eval")
    except SyntaxError:
        try:
            ast.parse(py_eq, mode="eval")
            better = re.sub(r"(?<![<>!=])=(?!=)", "==", src)
            out.append(("error", "uses a single = to compare — formulas need == there.", f"Write it as: {better}", better))
            tree = ast.parse(py_eq, mode="eval")
        except SyntaxError:
            out.append(("error", "isn't a formula Kura can read (check brackets, quotes and operators).",
                        "Example: weight / ((height/100)^2)", None))
            return out, refs
    funcs = _allowed_funcs()
    for node in ast.walk(tree):
        if not isinstance(node, _OK_NODES):
            out.append(("error", f"uses “{type(node).__name__}”, which Kura formulas can't do.", "", None))
            return out, refs
        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name) or node.func.id not in funcs or node.keywords:
                name = getattr(node.func, "id", "?")
                hint = "if_(condition, a, b)" if name == "if" else ""
                out.append(("error", f"calls “{name}()”, which isn't a Kura formula function.",
                            f"Available: {', '.join(sorted(funcs))}" + (f" — try {hint}" if hint else ""), None))
        if isinstance(node, ast.Name) and not (isinstance(getattr(node, "_parent", None), ast.Call)):
            refs.add(node.id)
    for c in [n for n in ast.walk(tree) if isinstance(n, ast.Call)]:
        if isinstance(c.func, ast.Name):
            refs.discard(c.func.id)
    allowed = set(known) | ({"value"} if allow_value else set()) | {"True", "False"}
    unknown = sorted(n for n in refs if n not in allowed)
    for n in unknown:
        out.append(("warning", f"refers to “{n}”, which isn't a question name in this file — it would count as 0.",
                    _did_you_mean(n, list(known)) or ("Use value for this answer." if n in (".", "self", "this") else ""), None))
    return out, refs


def validate(form, issues):
    """Deep checks on a parsed form. Mutates nothing; appends to issues."""
    src = form.get("source") or {}
    sheet = src.get("sheet", "Questions")
    letters = src.get("letters") or {}
    qs = form["questions"]

    def at(q, key):
        row = q.get("_row")
        return {"sheet": sheet, "row": row, "key": key, "cell": f"{letters[key]}{row}" if key in letters and row else None,
                "q": q["name"]}

    order, by_name, first_holder = [], {}, {}
    for q, parent in iter_questions(qs):
        order.append((q, parent))
        by_name.setdefault(q["name"], []).append(q)
        first_holder.setdefault(q["name"], q)
    all_names = set(by_name)
    pos = {id(q): i for i, (q, _p) in enumerate(order)}

    # names
    for name, holders in by_name.items():
        if len(holders) > 1:
            for dup in holders[1:]:
                issues.append(Issue("error", "question",
                                    f"The name “{name}” is used {len(holders)} times. On import Kura renames the copy — and "
                                    f"re-points every “{name}” rule at the copy, so skip logic silently changes.",
                                    fix=f"Give it its own name, e.g. {name}_2.", fixable=True,
                                    _apply={"field": "name", "value": "__unique__"}, **at(dup, "name")))
    for q, _p in order:
        has_raw = bool(q.get("_raw"))
        raw = q.get("_raw_name") or ""
        if raw and raw != q["name"]:
            issues.append(Issue("info", "question", f"Name “{raw}” will be stored as “{q['name']}” (letters, numbers and _ only).",
                                fixable=True, _apply={"field": "_raw_name"}, **at(q, "name")))
        if has_raw and q["type"] not in DISPLAY_TYPES and q["type"] != "repeat" and not q["_raw"].get("label"):
            issues.append(Issue("warning", "question", "This question has no wording, so respondents would see only "
                                f"“{q['label']}”.", fix="Write the question in the Question column.", **at(q, "label")))
        if len(q.get("label") or "") > 300:
            issues.append(Issue("info", "question", f"The question is {len(q['label'])} characters long — long questions "
                                "get worse answers.", fix="Move detail into Hint / help.", **at(q, "label")))
        raw_req = (q.get("_raw") or {}).get("required", "")
        if raw_req and q["type"] in DISPLAY_TYPES:
            issues.append(Issue("info", "question", f"“Required” is ignored on a {FRIENDLY_TYPES[q['type']]}.",
                                fixable=True, _apply={"field": "required_clear"}, **at(q, "required")))
        elif raw_req and not _truthy(raw_req) and not re.fullmatch(r"(no|n|false|0|optional|-)", raw_req.strip(), re.I):
            issues.append(Issue("warning", "question", f"Required says “{raw_req}”, which Kura reads as not required.",
                                fix="Write Yes or leave it blank.", **at(q, "required")))
        raw_choices = (q.get("_raw") or {}).get("choices", "")
        if raw_choices and q["type"] not in CHOICE_TYPES:
            issues.append(Issue("warning", "choices", f"Choices are listed but “{FRIENDLY_TYPES.get(q['type'], q['type'])}” "
                                "doesn't use them.", fix="Change the type to Choose one / Choose many, or clear the choices.",
                                **at(q, "choices")))

    # choices
    for q, _p in order:
        if q["type"] not in CHOICE_TYPES:
            continue
        cs = q.get("choices") or []
        raw_cell = (q.get("_raw") or {}).get("choices", "")
        if not cs:
            if q["type"] == "likert":
                issues.append(Issue("warning", "choices", "This Likert scale has no choices.",
                                    fix="Foon can add the standard 5-point agreement scale.", fixable=True,
                                    _apply={"field": "likert_default"}, **at(q, "choices")))
            else:
                where = "the Choices sheet has no rows for it" if raw_cell.startswith("(") else "the Choices cell is empty"
                issues.append(Issue("error", "choices", f"“{q['label']}” needs answer options, but {where}.",
                                    fix="List options like  yes = Yes; no = No  or add rows to the Choices sheet.",
                                    **at(q, "choices")))
            continue
        if len(cs) == 1:
            issues.append(Issue("warning", "choices", "Only one answer option — respondents can't really choose.",
                                fix="Add at least one more option.", **at(q, "choices")))
        if any(re.fullmatch(r"option ?\d+", str(c.get("label") or ""), re.I) for c in cs):
            issues.append(Issue("warning", "choices", "Still has placeholder options (“Option 1”).",
                                fix="Write the real answer options.", **at(q, "choices")))
        if raw_cell and not raw_cell.startswith("("):
            parts = [x.strip() for x in re.split(r"\r?\n|;", raw_cell) if x.strip()]
            vals = [p[:p.find("=")].strip() if p.find("=") > 0 else None for p in parts]
            given = [v for v in vals if v]
            dups = sorted({v for v in given if given.count(v) > 1})
            if dups:
                issues.append(Issue("warning", "choices", f"Option value(s) {', '.join(dups)} appear twice — Kura renames the "
                                    "second, which can break skip logic that uses it.", fix="Give every option its own value.",
                                    **at(q, "choices")))
            if 0 < len(given) < len(parts):
                issues.append(Issue("info", "choices", "Some options have a value (y = Yes) and some don't — Kura makes "
                                    "values from the labels for the rest.", **at(q, "choices")))

    # cascades
    for q, _p in order:
        casc = (q.get("cascade") or {}).get("parent")
        if not casc:
            continue
        parent = first_holder.get(casc)
        if not parent:
            issues.append(Issue("error", "choices", f"“Filter choices by” names “{casc}”, which isn't a question here.",
                                fix=_did_you_mean(casc, all_names), **at(q, "cascade")))
            continue
        if parent["type"] not in CHOICE_TYPES:
            issues.append(Issue("error", "choices", f"“{casc}” isn't a choice question, so it can't filter these options.",
                                **at(q, "cascade")))
            continue
        if pos[id(parent)] > pos[id(q)]:
            issues.append(Issue("error", "logic", f"“{casc}” comes after this question — the parent must be asked first.",
                                **at(q, "cascade")))
        pvals = {str(c["value"]) for c in parent.get("choices") or []}
        cs = q.get("choices") or []
        no_parent = [c for c in cs if not c.get("parent")]
        if cs and len(no_parent) == len(cs):
            issues.append(Issue("error", "choices", f"None of these options says which “{casc}” answer it belongs to.",
                                fix="Fill the Parent value column in the Choices sheet.", **at(q, "cascade")))
        bad = sorted({c["parent"] for c in cs if c.get("parent") and str(c["parent"]) not in pvals})
        if bad:
            issues.append(Issue("warning", "choices", f"Parent value(s) {', '.join(bad[:5])} aren't options of “{casc}” — "
                                "those choices would never show.", **at(q, "cascade")))

    # skip logic
    for q, parent in order:
        rawshow = (q.get("_raw") or {}).get("show", "")
        for bad in q.get("_show_bad") or []:
            issues.append(Issue("error", "logic", f"Kura can't read the condition “{bad}” — the builder would drop it and "
                                "always show this question.",
                                fix="Write it like  consent = yes,  age >= 18,  symptoms has selected fever,  phone is answered.",
                                **at(q, "show")))
        if q.get("_show_mixed"):
            issues.append(Issue("error", "logic", f"“{rawshow}” mixes and with or — one cell can only use one kind, so Kura "
                                "would misread it.", fix="Use only and (or only or); split the rest with a Section that has "
                                "its own Show when.", **at(q, "show")))
        if q["type"] == "section" and parent is not None:
            pass
        rules = []
        walk_rules(q.get("relevant"), rules.append)
        for r in rules:
            target = first_holder.get(r["q"])
            if target is None:
                sane = sanitize_name(r["q"])
                to = sane if sane in all_names and sane != r["q"] else \
                    next(iter(difflib.get_close_matches(sane, sorted(all_names), n=1, cutoff=0.85)), None)
                issues.append(Issue("error", "logic", f"Show when refers to “{r['q']}”, which isn't a question name here.",
                                    fix=(f"Did you mean “{to}”?" if to else _did_you_mean(r["q"], all_names)),
                                    fixable=bool(to), _apply={"field": "rule_q", "from": r["q"], "to": to} if to else None,
                                    **at(q, "show")))
                continue
            if target is q:
                issues.append(Issue("error", "logic", "Show when refers to this same question.", **at(q, "show")))
                continue
            if pos[id(target)] > pos[id(q)]:
                issues.append(Issue("error", "logic", f"Show when depends on “{r['q']}”, which comes later in the form — "
                                    "respondents haven't answered it yet.", fix=f"Move “{r['q']}” above this row.",
                                    **at(q, "show")))
            tparent = next((p for qq, p in order if qq is target), None)
            if tparent is not None and tparent is not parent:
                issues.append(Issue("warning", "logic", f"“{r['q']}” is inside the repeat “{tparent['label']}”, so outside it "
                                    "there's no single answer to compare.", **at(q, "show")))
            cmp_, val = r.get("cmp"), r.get("value")
            if cmp_ in ("gt", "gte", "lt", "lte"):
                if _num(val) is None:
                    issues.append(Issue("warning", "logic", f"“{r['q']} {CMP_TO_TEXT[cmp_]} {val}” compares with something "
                                        "that isn't a number.", **at(q, "show")))
                elif target["type"] not in NUMERIC_TYPES and target["type"] not in ("date", "datetime", "time"):
                    issues.append(Issue("warning", "logic", f"“{r['q']}” is {FRIENDLY_TYPES.get(target['type'], target['type'])}, "
                                        "so a greater/less-than comparison may not behave as expected.", **at(q, "show")))
            if cmp_ in ("eq", "ne", "selected", "not_selected") and target["type"] in CHOICE_TYPES and target.get("choices"):
                vals = [str(c["value"]) for c in target["choices"]]
                wanted = [x.strip() for x in str(val).split(",")] if cmp_ in ("selected", "not_selected") else [str(val)]
                for w in wanted:
                    if w in vals:
                        continue
                    by_label = next((str(c["value"]) for c in target["choices"]
                                     if str(c.get("label") or "").lower() == w.lower() or str(c["value"]).lower() == w.lower()), None)
                    close = by_label or next(iter(difflib.get_close_matches(w, vals, n=1, cutoff=0.7)), None)
                    issues.append(Issue(
                        "error", "logic",
                        f"“{w}” isn't one of the values of “{r['q']}” ({', '.join(vals[:6])}{'…' if len(vals) > 6 else ''}), "
                        "so this condition would never match.",
                        fix=(f"Use “{close}”" + (" — that's the value behind the label" if by_label else "") + ".") if close else
                        "Use one of the option values (the part before = in the Choices cell).",
                        fixable=bool(close), _apply={"field": "rule_value", "q_ref": r["q"], "from": w, "to": close} if close else None,
                        **at(q, "show")))

    # min / max / regex / rules / calculations
    numeric_names = {q["name"] for q, _p in order if q["type"] in NUMERIC_TYPES}
    for q, parent in order:
        v = q.get("validate") or {}
        raw = q.get("_raw") or {}
        for key in ("min", "max"):
            if raw.get(key) and _num(raw[key]) is None:
                m = re.search(r"-?\d+(?:\.\d+)?", raw[key])
                issues.append(Issue("error", "calc", f"{key.title()} “{raw[key]}” isn't a number.",
                                    fix=f"Write just the number, e.g. {m.group(0)}." if m else "Write a number.",
                                    fixable=bool(m), _apply={"field": key, "value": _num(m.group(0))} if m else None,
                                    **at(q, key)))
        lo, hi = (v.get("min"), v.get("max")) if q["type"] != "repeat" else \
            ((q.get("repeat") or {}).get("min"), (q.get("repeat") or {}).get("max"))
        if lo is not None and hi is not None and lo > hi:
            issues.append(Issue("error", "calc", f"Min ({lo}) is bigger than Max ({hi}) — no answer could pass.",
                                fix="Swap them.", fixable=True, _apply={"field": "swap_minmax"}, **at(q, "min")))
        if (v.get("min") is not None or v.get("max") is not None) and q["type"] not in NUMERIC_TYPES + ("repeat",):
            issues.append(Issue("info", "calc", f"Min/Max on {FRIENDLY_TYPES.get(q['type'], q['type'])} isn't a number range.",
                                **at(q, "min" if v.get("min") is not None else "max")))
        if q["type"] in ("integer", "decimal") and v.get("min") is None and v.get("max") is None:
            issues.append(Issue("info", "calc", "No Min or Max — typing mistakes like 999 would be accepted.",
                                fix="Add a sensible range.", **at(q, "min")))
        if v.get("regex"):
            try:
                re.compile(v["regex"])
            except re.error as exc:
                issues.append(Issue("error", "calc", f"The pattern “{v['regex']}” is broken ({exc}).",
                                    fix="Example for a 7-digit phone number: ^[0-9]{7}$", **at(q, "regex")))
            if q["type"] not in ("text", "long_text", "barcode"):
                issues.append(Issue("warning", "calc", "A Pattern only checks text answers — it's ignored here.", **at(q, "regex")))
        if v.get("warn_message") and not v.get("warn_expr"):
            issues.append(Issue("info", "calc", "There's a Warning message but no Warn when false rule to trigger it.",
                                **at(q, "warn_message")))
        known_here = set(all_names)
        for key, allow_value in (("expr", True), ("warn_expr", True)):
            if v.get(key):
                probs, _refs = check_expression(v[key], known_here, allow_value)
                for level, msg, fix, fixed in probs:
                    issues.append(Issue(level, "calc", f"The rule “{v[key]}” {msg}", fix=fix, fixable=bool(fixed),
                                        _apply={"field": key, "value": fixed} if fixed else None, **at(q, key)))
        if q["type"] == "calculate":
            if not q.get("calc"):
                issues.append(Issue("error", "calc", "A Calculated question needs a formula in the Calculation column.",
                                    fix="Example: price * quantity", **at(q, "calc")))
            else:
                probs, _refs = check_expression(q["calc"], known_here - {q["name"]})
                for level, msg, fix, fixed in probs:
                    issues.append(Issue(level, "calc", f"The formula “{q['calc']}” {msg}", fix=fix, fixable=bool(fixed),
                                        _apply={"field": "calc", "value": fixed} if fixed else None, **at(q, "calc")))
                if q["name"] in _refs:
                    issues.append(Issue("error", "calc", "The formula uses its own answer.", **at(q, "calc")))
        elif raw.get("calc") and q["type"] != "repeat":
            issues.append(Issue("warning", "calc", f"A Calculation on {FRIENDLY_TYPES.get(q['type'], q['type'])} is ignored — "
                                "only Calculated (hidden) and Repeat group use it.", **at(q, "calc")))
        if q["type"] == "repeat":
            ce = (q.get("repeat") or {}).get("count_expr")
            if ce:
                ce_name = sanitize_name(ce.replace("${", "").replace("}", ""))
                if ce_name not in all_names:
                    issues.append(Issue("warning", "calc", f"The repeat count “{ce}” isn't a question name.",
                                        fix=_did_you_mean(ce, numeric_names), **at(q, "calc")))
                elif ce_name not in numeric_names:
                    issues.append(Issue("warning", "calc", f"“{ce}” isn't a number question, so it can't set how many times "
                                        "this repeats.", **at(q, "calc")))
            if not q.get("children"):
                issues.append(Issue("warning", "structure", "This Repeat group has no questions inside it.",
                                    fix="Add questions under it, then an End repeat row.", **at(q, "type")))

    # whole form
    answerable = [q for q, _p in order if q["type"] not in DISPLAY_TYPES + ("repeat",)]
    if not answerable:
        issues.append(Issue("error", "structure", "There are no questions to answer — only headers and notes.", sheet=sheet))
    from .agent_engine import detect_pii, _kind_for
    personal = [q for q in answerable if detect_pii({"name": q["name"], "label": q["label"], "type": q["type"],
                                                     "kind": _kind_for(q["type"])})["level"] == "direct"]
    has_consent = any(re.search(r"\b(consent|agree to (take )?part|participate)\b", q["label"], re.I) for q, _p in order)
    if personal and not has_consent:
        issues.append(Issue("warning", "question", f"The form collects personal data ({personal[0]['label']}…) but has no "
                            "consent question.", fix="Start with a consent question and show the rest only if it's yes.",
                            sheet=sheet, row=personal[0].get("_row"), q=personal[0]["name"],
                            cell=f"{letters['label']}{personal[0]['_row']}" if "label" in letters and personal[0].get("_row") else None))
    return issues


# ─────────────────────────────────────────────────────────────────────
#  Summary, score and the x-ray grid
# ─────────────────────────────────────────────────────────────────────

SECONDS = {"text": 20, "long_text": 45, "integer": 8, "decimal": 9, "select_one": 7, "select_multiple": 11,
           "rank": 18, "likert": 6, "rating": 5, "date": 8, "time": 7, "datetime": 10, "gps": 15, "mapper": 60,
           "photo": 20, "barcode": 10, "note": 6, "section": 1}


def summarize(form, issues):
    counts = {lv: sum(1 for i in issues if i.level == lv) for lv in LEVELS}
    qs = list(iter_questions(form["questions"]))
    answerable = [q for q, _p in qs if q["type"] not in DISPLAY_TYPES + ("repeat", "calculate")]
    seconds = sum(SECONDS.get(q["type"], 10) for q, _p in qs if q["type"] != "repeat")
    stats = {
        "questions": len(answerable),
        "required": sum(1 for q in answerable if q.get("required")),
        "sections": sum(1 for q, _p in qs if q["type"] == "section"),
        "choices": sum(len(q.get("choices") or []) for q, _p in qs),
        "logic": sum(1 for q, _p in qs if q.get("relevant")),
        "calculations": sum(1 for q, _p in qs if q["type"] == "calculate"),
        "repeats": sum(1 for q, _p in qs if q["type"] == "repeat"),
        "minutes": max(1, round(seconds / 60)),
    }
    score = 100 - 14 * counts["error"] - 4 * counts["warning"] - 1 * counts["info"]
    score = max(0, min(100, score))
    if counts["error"] == 0:
        score = max(score, 62)
    cats = {}
    for key, label in CATEGORIES.items():
        mine = [i for i in issues if i.cat == key and i.level in ("error", "warning")]
        cats[key] = {"label": label, "errors": sum(1 for i in mine if i.level == "error"),
                     "warnings": sum(1 for i in mine if i.level == "warning")}
    return {"counts": counts, "stats": stats, "score": score, "categories": cats,
            "ready": counts["error"] == 0, "fixable": sum(1 for i in issues if i.fixable and i.level != "fixed")}


GRID_KEYS = ["type", "label", "name", "required", "choices", "show", "cascade", "min", "max", "regex", "expr", "calc"]


def xray(book: Book, form, issues, max_rows=160):
    """A compact view of the Questions sheet with every problem cell marked."""
    src = form.get("source") or {}
    sheet = src.get("sheet")
    if not sheet or sheet not in book.sheets:
        return None
    rows = book.sheets[sheet]
    letters = src.get("letters") or {}
    hrow = (src.get("header_row") or 1) - 1
    flagged_keys = {i.key for i in issues if i.sheet == sheet and i.row and i.key}
    shown = rows[hrow + 1:hrow + 1 + max_rows]

    def has_values(k):
        ci = _col_index(letters[k])
        return any(ci < len(r) and str(r[ci]).strip() for r in shown)
    basics = ("type", "label", "name", "required", "choices", "show")
    keys = [k for k in GRID_KEYS if k in letters and (k in basics or k in flagged_keys or has_values(k))]
    severity = {}
    for i in issues:
        if i.sheet != sheet or not i.row or not i.key:
            continue
        rank = {"error": 3, "warning": 2, "fixed": 1, "info": 0}[i.level]
        k = (i.row, i.key)
        prev = severity.get(k)
        if prev is None or rank > prev[0]:
            severity[k] = (rank, i.level, i.msg)
    out_rows = []
    for idx in range(hrow + 1, min(len(rows), hrow + 1 + max_rows)):
        r = rows[idx]
        if not any(c.strip() for c in r):
            continue
        rowno = idx + 1
        cells = []
        for k in keys:
            ci = _col_index(letters[k])
            text = r[ci] if ci < len(r) else ""
            sv = severity.get((rowno, k))
            cells.append({"v": text[:80], "s": sv[1] if sv and sv[0] >= 1 else None, "m": sv[2] if sv else ""})
        row_level = max((severity[(rowno, k)][0] for k in keys if (rowno, k) in severity), default=-1)
        out_rows.append({"row": rowno, "cells": cells,
                         "s": {3: "error", 2: "warning", 1: "fixed"}.get(row_level)})
    return {"sheet": sheet, "columns": [{"key": k, "letter": letters[k],
                                         "label": KF_HEADERS[KF_KEYS.index(k)].split(" (")[0]} for k in keys],
            "rows": out_rows, "truncated": len(rows) - hrow - 1 > max_rows}


def _col_index(letter):
    from openpyxl.utils import column_index_from_string
    return column_index_from_string(letter) - 1


# ─────────────────────────────────────────────────────────────────────
#  Auto-fix
# ─────────────────────────────────────────────────────────────────────

LIKERT5 = [{"value": "1", "label": "Strongly disagree"}, {"value": "2", "label": "Disagree"},
           {"value": "3", "label": "Neutral"}, {"value": "4", "label": "Agree"}, {"value": "5", "label": "Strongly agree"}]


def autofix(form, issues):
    """Apply every safe fix. Returns (fixed_form, applied: list[Issue(level=fixed)])."""
    fixed = copy.deepcopy(form)
    lookup = {}
    for q, _p in iter_questions(fixed["questions"]):
        lookup.setdefault(q.get("_row"), q)
    used = {q["name"] for q, _p in iter_questions(fixed["questions"])}
    applied = []
    seen_rows_for_unique = set()
    for i in issues:
        if not i.fixable or not i._apply:
            continue
        a = i._apply
        q = lookup.get(i.row)
        what = None
        if a["field"] == "_close_repeat":
            what = "closed the repeat with End repeat"
            if q:
                q["_close_note"] = True
        if q is None:
            if what:
                applied.append(Issue("fixed", i.cat, f"Foon {what}.", sheet=i.sheet, row=i.row, key=i.key, cell=i.cell, q=i.q))
            continue
        f = a["field"]
        if f == "type":
            old = (q.get("_raw") or {}).get("type")
            q["type"] = a["value"]
            if a["value"] in CHOICE_TYPES and not q.get("choices"):
                q["choices"] = parse_choices_cell((q.get("_raw") or {}).get("choices"))
            if a["value"] == "calculate":
                q["calc"] = (q.get("_raw") or {}).get("calc", "")
            if a["value"] == "repeat":
                q.setdefault("children", [])
                q.setdefault("repeat", {"min": None, "max": None, "item_label": "Item ${index}"})
            what = f"changed the type “{old}” to “{FRIENDLY_TYPES[a['value']]}”"
        elif f == "name" and a["value"] == "__unique__":
            if i.row in seen_rows_for_unique:
                continue
            seen_rows_for_unique.add(i.row)
            base, n = q["name"], 2
            while f"{base}_{n}" in used:
                n += 1
            q["name"] = f"{base}_{n}"
            used.add(q["name"])
            what = f"renamed the duplicate to “{q['name']}” (skip logic keeps pointing at the first “{base}”)"
        elif f == "_raw_name":
            what = f"stored the name as “{q['name']}”"
        elif f == "required_clear":
            q["required"] = False
            what = "cleared Required on a display item"
        elif f == "likert_default":
            q["choices"] = copy.deepcopy(LIKERT5)
            what = "added the 5-point agreement scale"
        elif f == "swap_minmax":
            if q["type"] == "repeat":
                rp = q.setdefault("repeat", {})
                rp["min"], rp["max"] = rp.get("max"), rp.get("min")
            else:
                v = q.setdefault("validate", {})
                v["min"], v["max"] = v.get("max"), v.get("min")
            what = "swapped Min and Max"
        elif f in ("min", "max"):
            q.setdefault("validate", {})[f] = a["value"]
            what = f"set {f.title()} to {a['value']}"
        elif f in ("expr", "warn_expr"):
            q.setdefault("validate", {})[f] = a["value"]
            what = f"rewrote the rule as “{a['value']}”"
        elif f == "calc":
            q["calc"] = a["value"]
            what = f"rewrote the formula as “{a['value']}”"
        elif f == "rule_q":
            def fix_q(r, a=a):
                if r.get("q") == a["from"]:
                    r["q"] = a["to"]
            walk_rules(q.get("relevant"), fix_q)
            what = f"pointed the condition at “{a['to']}”"
        elif f == "rule_value":
            def fix_v(r, a=a):
                if r.get("q") == a["q_ref"]:
                    if isinstance(r.get("value"), str) and "," in r["value"] and r.get("cmp") in ("selected", "not_selected"):
                        r["value"] = ",".join(a["to"] if x.strip() == a["from"] else x.strip() for x in r["value"].split(","))
                    elif str(r.get("value")) == a["from"]:
                        r["value"] = a["to"]
            walk_rules(q.get("relevant"), fix_v)
            what = f"used the value “{a['to']}” instead of “{a['from']}”"
        if what:
            applied.append(Issue("fixed", i.cat, f"Foon {what}.", sheet=i.sheet, row=i.row, key=i.key, cell=i.cell,
                                 q=q["name"]))
    # Every fixed question now reads cleanly: drop the parse-time leftovers.
    for q, _p in iter_questions(fixed["questions"]):
        if q.get("_raw_name") and q["_raw_name"] != q["name"]:
            q["_raw_name"] = q["name"]
    return fixed, applied


def fix_all(form, issues, rounds=3):
    """Auto-fix in rounds: fixing a type can reveal new safe fixes (a
    condition's value only becomes checkable once its question is a real
    Choose one). Returns (fixed_form, applied, remaining_issues)."""
    applied, current, cur_issues = [], form, issues
    for _ in range(rounds):
        if not any(i.fixable and i._apply for i in cur_issues):
            break
        current, done = autofix(current, cur_issues)
        applied += done
        cur_issues = recheck(current)
    else:
        cur_issues = recheck(current)
    return current, applied, cur_issues


def recheck(fixed_form):
    """Validate a fixed form. Parse-time problems (unknown types, unreadable
    conditions…) were either fixed in the model or are carried by the
    question itself (_show_bad), so only the raw cells that a fix may have
    replaced need refreshing first."""
    for q, _p in iter_questions(fixed_form["questions"]):
        raw = dict(q.get("_raw") or {})
        if raw:
            if q["type"] == "repeat":
                rep = q.get("repeat") or {}
                raw["min"] = "" if rep.get("min") is None else str(rep["min"])
                raw["max"] = "" if rep.get("max") is None else str(rep["max"])
            else:
                v = q.get("validate") or {}
                raw["min"] = "" if v.get("min") is None else str(v["min"])
                raw["max"] = "" if v.get("max") is None else str(v["max"])
            if q["type"] in DISPLAY_TYPES and not q.get("required"):
                raw["required"] = ""
            q["_raw"] = raw
        q.setdefault("_show_bad", [])
        q.setdefault("_show_mixed", False)
    return validate(fixed_form, [])


# ─────────────────────────────────────────────────────────────────────
#  Turning a checked form into a survey schema
# ─────────────────────────────────────────────────────────────────────

def to_schema_questions(form):
    """Strip check-time keys; uniquify names like the builder's prepareQuestions
    but WITHOUT re-pointing rules at the renamed copy."""
    used = set()
    out = []

    def clean(q):
        q = {k: v for k, v in q.items() if not k.startswith("_")}
        if q.get("choices"):
            q["choices"] = [{k: v for k, v in c.items() if not k.startswith("_")} for c in q["choices"]]
        if q.get("type") not in TYPE_IDS:
            q["type"] = "text"
        base, n = q.get("name") or q["type"], 2
        name = sanitize_name(base) or "q"
        cand = name
        while cand in used:
            cand = f"{name}_{n}"
            n += 1
        used.add(cand)
        q["name"] = cand
        q.setdefault("hint", "")
        q.setdefault("validate", {})
        q.setdefault("relevant", None)
        q.setdefault("appearance", "default")
        return q

    for q in form["questions"]:
        top = clean(q)
        if top.get("children") is not None:
            top["children"] = [clean(c) for c in q.get("children") or []]
        out.append(top)
    return out


# ─────────────────────────────────────────────────────────────────────
#  Writing: the polished template / fixed workbook
# ─────────────────────────────────────────────────────────────────────

def _question_row(q, indicator_codes):
    v = q.get("validate") or {}
    rep = q.get("repeat") or {}
    isrep = q.get("type") == "repeat"
    return [
        FRIENDLY_TYPES.get(q.get("type"), q.get("type")), q.get("label") or "", q.get("name") or "",
        "Yes" if q.get("required") else "",
        choices_cell_text(q) if q.get("type") in CHOICE_TYPES else "",
        q.get("hint") or "", show_when_text(q.get("relevant")), (q.get("cascade") or {}).get("parent", ""),
        (rep.get("min") if rep.get("min") is not None else "") if isrep else (v.get("min") if v.get("min") is not None else ""),
        (rep.get("max") if rep.get("max") is not None else "") if isrep else (v.get("max") if v.get("max") is not None else ""),
        v.get("regex", ""), v.get("expr", ""), v.get("warn_expr", ""), v.get("warn_message", ""), v.get("message", ""),
        (rep.get("count_expr") or "") if isrep else (q.get("calc") or ""),
        indicator_codes.get(q.get("indicator"), "") if q.get("indicator") else "",
    ]


def build_workbook(title="", description="", questions=None, indicators=None, marks=None, notes=None,
                   blank_rows=0) -> bytes:
    """A Kura Form workbook: same sheets/columns/order as the builder's
    buildWorkbook (so it re-imports), plus a dropdown on Type and Required,
    column help on every heading, and — for fixed workbooks — green cells with
    comments where Foon changed something, and a "Foon check" sheet."""
    from openpyxl import Workbook
    from openpyxl.comments import Comment
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.worksheet.datavalidation import DataValidation

    questions = questions or []
    indicators = indicators or []
    marks = marks or {}
    wb = Workbook()
    head_fill = PatternFill("solid", fgColor="2B2F77")
    head_font = Font(bold=True, color="FFFFFF")
    thin = Side(style="thin", color="D5D9EE")

    ws = wb.active
    ws.title = "📖 Read me"
    for line in README:
        ws.append([line])
    ws["A1"].font = Font(bold=True, size=14, color="2B2F77")
    for r in (3, len(README) - 2):
        ws.cell(row=r, column=1).font = Font(bold=True, color="FF3F98")
    ws.column_dimensions["A"].width = 90

    wf = wb.create_sheet("Form")
    wf.append(["Title", title or ""])
    wf.append(["Description", description or ""])
    wf.column_dimensions["A"].width = 14
    wf.column_dimensions["B"].width = 70
    for c in ("A1", "A2"):
        wf[c].font = Font(bold=True)

    wq = wb.create_sheet("Questions")
    wq.append(KF_HEADERS)
    for ci, cell in enumerate(wq[1]):
        cell.fill, cell.font = head_fill, head_font
        cell.alignment = Alignment(vertical="center", wrap_text=True)
        help_text = COLUMN_HELP.get(KF_KEYS[ci])
        if help_text:
            cell.comment = Comment(help_text, "Foon")
            cell.comment.width, cell.comment.height = 320, 140
    wq.row_dimensions[1].height = 32
    for i, w in enumerate(KF_WIDTHS):
        wq.column_dimensions[col_letter(i)].width = w
    wq.freeze_panes = "C2"

    codes = {d.get("id"): d.get("code") or d.get("name") for d in indicators}
    choice_rows = []
    row_of = {}

    def flush(q):
        wq.append(_question_row(q, codes))
        row_of[q.get("name")] = wq.max_row
        if q.get("type") in CHOICE_TYPES and choices_cell_text(q) == "(see the Choices sheet)":
            for c in q.get("choices") or []:
                choice_rows.append([q["name"], c["value"], c.get("label") or "", c.get("parent") or "",
                                    ",".join(c["zones"]) if isinstance(c.get("zones"), list) else ""])
    for q in questions:
        flush(q)
        if q.get("type") == "repeat":
            for c in q.get("children") or []:
                flush(c)
            wq.append(["End repeat"] + [""] * 16)
            end_cell = wq.cell(row=wq.max_row, column=1)
            end_cell.font = Font(italic=True, color="7680AD")
            if q.get("_close_note"):
                end_cell.fill = PatternFill("solid", fgColor="D1FAE5")
                end_cell.comment = Comment("Foon added this End repeat row.", "Foon")
    for _ in range(blank_rows):
        wq.append([""] * 17)
    last = max(wq.max_row, 2)
    for row in wq.iter_rows(min_row=2, max_row=last):
        for cell in row:
            cell.alignment = Alignment(wrap_text=True, vertical="top")
            cell.border = Border(bottom=thin)
        t = str(row[0].value or "").lower()
        if t in ("section header", "repeat group"):
            for cell in row:
                cell.font = Font(bold=True, color="FF8A1F" if t == "section header" else "8B5CF6")

    # Lists sheet feeds the dropdowns (hidden; its name matches no Kura sheet)
    wl = wb.create_sheet("Lists")
    types = [FRIENDLY_TYPES[t] for t in FRIENDLY_TYPES] + ["End repeat"]
    for i, t in enumerate(types, 1):
        wl.cell(row=i, column=1, value=t)
    wl.cell(row=1, column=2, value="Yes")
    wl.cell(row=2, column=2, value="No")
    wl.sheet_state = "hidden"
    first_row, last_row = 2, last + 300
    dv_type = DataValidation(type="list", formula1=f"=Lists!$A$1:$A${len(types)}", allow_blank=True,
                             showErrorMessage=True, errorStyle="information",
                             errorTitle="Not a standard type", error="Kura also understands names like Dropdown or "
                             "Checkbox — Foon will check it.", promptTitle="Question type",
                             prompt="Pick a type, or type a familiar name.", showInputMessage=True)
    dv_req = DataValidation(type="list", formula1="=Lists!$B$1:$B$2", allow_blank=True, showErrorMessage=False)
    wq.add_data_validation(dv_type)
    wq.add_data_validation(dv_req)
    dv_type.add(f"A{first_row}:A{last_row}")
    dv_req.add(f"D{first_row}:D{last_row}")

    if choice_rows:
        wc = wb.create_sheet("Choices")
        wc.append(["Question name", "Value", "Label", "Parent value", "Zones"])
        for r in choice_rows:
            wc.append(r)
        for cell in wc[1]:
            cell.fill, cell.font = head_fill, head_font
        for i, w in enumerate([18, 16, 34, 14, 16]):
            wc.column_dimensions[col_letter(i)].width = w
        wc.freeze_panes = "A2"
    if indicators:
        wi = wb.create_sheet("Indicators")
        wi.append(["Code", "Name", "Target"])
        for d in indicators:
            wi.append([d.get("code") or "", d.get("name") or "", d.get("target") if d.get("target") is not None else ""])
        for cell in wi[1]:
            cell.fill, cell.font = head_fill, head_font
        for i, w in enumerate([14, 44, 10]):
            wi.column_dimensions[col_letter(i)].width = w

    # Marks: {(question name, key): (level, message)}
    styles = {"fixed": "D1FAE5", "error": "FEE2E2", "warning": "FEF3C7"}
    for (qname, key), (level, msg) in marks.items():
        r = row_of.get(qname)
        if not r or key not in KF_KEYS:
            continue
        c = wq.cell(row=r, column=KF_KEYS.index(key) + 1)
        c.fill = PatternFill("solid", fgColor=styles.get(level, "E0E7FF"))
        c.comment = Comment(msg[:900], "Foon")
        c.comment.width, c.comment.height = 300, 120

    if notes:
        _notes_sheet(wb, notes, "Questions", row_of)
    wb.move_sheet("Lists", offset=len(wb.sheetnames))
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _notes_sheet(wb, notes, qsheet, row_of=None):
    """The "Foon check" sheet: every finding with a link to its cell."""
    from openpyxl.styles import Alignment, Font, PatternFill
    ws = wb.create_sheet("Foon check", 0)
    ws.append(["Foon checked this questionnaire"])
    ws["A1"].font = Font(bold=True, size=14, color="2B2F77")
    ws.append([])
    ws.append(["", "Severity", "Where", "What Foon found", "How to fix"])
    for cell in ws[3]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="2B2F77")
    fills = {"error": "FEE2E2", "warning": "FEF3C7", "info": "E0E7FF", "fixed": "D1FAE5"}
    marks = {"error": "✖", "warning": "!", "info": "i", "fixed": "✔"}
    order = {"error": 0, "warning": 1, "fixed": 2, "info": 3}
    for n in sorted(notes, key=lambda i: (order.get(i.level, 4), i.row or 0)):
        where = f"{n.sheet}!{n.cell}" if n.cell else (f"{n.sheet} row {n.row}" if n.row else n.sheet)
        ws.append([marks.get(n.level, ""), n.level.title(), where, n.msg, n.fix])
        r = ws.max_row
        for c in ws[r]:
            c.fill = PatternFill("solid", fgColor=fills.get(n.level, "FFFFFF"))
            c.alignment = Alignment(wrap_text=True, vertical="top")
        if n.cell and n.sheet in wb.sheetnames:
            link = ws.cell(row=r, column=3)
            link.hyperlink = f"#'{n.sheet}'!{n.cell}"
            link.font = Font(color="1D4ED8", underline="single")
    for col, w in zip("ABCDE", (4, 10, 18, 70, 46)):
        ws.column_dimensions[col].width = w
    ws.freeze_panes = "A4"
    return ws


def markup_original(data: bytes, issues, filename="") -> bytes:
    """The user's OWN workbook, untouched except for coloured, commented
    problem cells and a "Foon check" sheet at the front."""
    from openpyxl import load_workbook
    from openpyxl.comments import Comment
    from openpyxl.styles import PatternFill
    wb = load_workbook(io.BytesIO(data))
    fills = {"error": "FECACA", "warning": "FDE68A", "info": "C7D2FE"}
    per_cell = {}
    for i in issues:
        if i.level == "fixed" or not i.cell or i.sheet not in wb.sheetnames:
            continue
        per_cell.setdefault((i.sheet, i.cell), []).append(i)
    rank = {"error": 0, "warning": 1, "info": 2}
    for (sheet, ref), lst in per_cell.items():
        lst.sort(key=lambda x: rank.get(x.level, 3))
        c = wb[sheet][ref]
        c.fill = PatternFill("solid", fgColor=fills.get(lst[0].level, "E5E7EB"))
        text = "\n\n".join(f"{x.level.upper()}: {x.msg}" + (f"\n→ {x.fix}" if x.fix else "") for x in lst)
        c.comment = Comment(text[:1500], "Foon")
        c.comment.width, c.comment.height = 340, 160
    if "Foon check" in wb.sheetnames:
        del wb["Foon check"]
    _notes_sheet(wb, issues, None)
    wb.active = 0
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ─────────────────────────────────────────────────────────────────────
#  Kobo / ODK XLSForm → Kura Form
# ─────────────────────────────────────────────────────────────────────

XLS_TYPES = {
    "text": "text", "string": "text", "integer": "integer", "int": "integer", "decimal": "decimal", "note": "note",
    "date": "date", "time": "time", "datetime": "datetime", "geopoint": "gps", "geotrace": "mapper", "geoshape": "mapper",
    "image": "photo", "photo": "photo", "audio": "audio", "barcode": "barcode", "calculate": "calculate",
    "acknowledge": "select_one", "range": "integer",
}
XLS_META = {"start", "end", "today", "deviceid", "username", "simserial", "subscriberid", "phonenumber", "audit",
            "start-geopoint", "background-geopoint", "email"}


def _xls_col(header, *names):
    for want in names:
        for ci, h in enumerate(header):
            k = h.strip().lower()
            if k == want or k.startswith(want + "::") or k.startswith(want + ":"):
                return ci
    return None


def _unwrap(p):
    """Drop brackets that wrap the WHOLE part: "(a = 1)" → "a = 1", but
    "selected(a, 'x')" stays intact."""
    while p.startswith("(") and p.endswith(")"):
        depth = 0
        for i, ch in enumerate(p):
            depth += ch == "("
            depth -= ch == ")"
            if depth == 0 and i < len(p) - 1:
                return p
        p = p[1:-1].strip()
    return p


def _xls_expr_to_rules(expr):
    """Simple XLSForm relevance → Kura rules. Returns (relevant, ok)."""
    s = str(expr or "").strip()
    if not s:
        return None, True
    has_or, has_and = bool(re.search(r"\sor\s", s)), bool(re.search(r"\sand\s", s))
    if has_or and has_and:
        return None, False
    parts = re.split(r"\s+or\s+" if has_or else r"\s+and\s+", s)
    rules = []
    for p in parts:
        p = _unwrap(p.strip())
        m = re.fullmatch(r"(not\s*\(\s*)?selected\(\s*\$\{(\w+)\}\s*,\s*['\"]([^'\"]*)['\"]\s*\)\s*\)?", p)
        if m:
            rules.append({"q": m[2], "cmp": "not_selected" if m[1] else "selected", "value": m[3]})
            continue
        m = re.fullmatch(r"string-length\(\s*\$\{(\w+)\}\s*\)\s*>\s*0", p)
        if m:
            rules.append({"q": m[1], "cmp": "answered", "value": ""})
            continue
        m = re.fullmatch(r"\$\{(\w+)\}\s*(!=|>=|<=|=|>|<)\s*['\"]?([^'\"]*)['\"]?", p)
        if m:
            q, op, val = m[1], m[2], m[3]
            if val == "" and op in ("=", "!="):
                rules.append({"q": q, "cmp": "not_answered" if op == "=" else "answered", "value": ""})
            else:
                rules.append({"q": q, "cmp": _CMP_OPS[op], "value": val})
            continue
        return None, False
    return ({"op": "or" if has_or else "and", "rules": rules} if rules else None), True


def _xls_formula(expr, value_word=True):
    s = str(expr or "").strip()
    if not s:
        return "", True
    out = re.sub(r"\$\{(\w+)\}", r"\1", s)
    if value_word:
        out = re.sub(r"(?<![\w.])\.(?![\w.])", "value", out)
    out = re.sub(r"\bdiv\b", "/", out)
    out = re.sub(r"\bmod\b", "%", out)
    out = re.sub(r"\bif\s*\(", "if_(", out)
    out = re.sub(r"(?<![<>!=])=(?!=)", "==", out)
    unsupported = re.search(r"\b(selected|regex|position|indexed-repeat|string-length|concat|substr|pulldata|today|now|"
                            r"format-date|count-selected|once|jr:\w+)\s*\(", out)
    path_like = "/" in out.replace(" / ", " ")
    return out, not (unsupported or path_like)


def parse_xlsform(book: Book):
    issues = []
    sname = next(x for x in book.names if norm_key(x) == "survey")
    rows = book.sheets[sname]
    hi = next(i for i, r in enumerate(rows[:5]) if {"type", "name"} <= {norm_key(c) for c in r})
    header = [str(c) for c in rows[hi]]
    col = {k: _xls_col(header, *names) for k, names in {
        "type": ("type",), "name": ("name",), "label": ("label",), "hint": ("hint",), "required": ("required",),
        "relevant": ("relevant",), "constraint": ("constraint",), "cmsg": ("constraint_message", "constraint message"),
        "calc": ("calculation",), "filter": ("choice_filter",), "repeat_count": ("repeat_count",),
        "params": ("parameters",)}.items()}

    def g(r, k):
        ci = col.get(k)
        return "" if ci is None or ci >= len(r) else str(r[ci] or "").strip()

    # choices
    lists = {}
    cname = next((x for x in book.names if norm_key(x) == "choices"), None)
    choice_extra_cols = {}
    if cname:
        crows = book.sheets[cname]
        chi = next((i for i, r in enumerate(crows[:5]) if {"listname", "name"} <= {norm_key(c) for c in r}), None)
        if chi is not None:
            ch = [str(c) for c in crows[chi]]
            li, ni, la = _xls_col(ch, "list_name", "list name"), _xls_col(ch, "name"), _xls_col(ch, "label")
            standard = {li, ni, la}
            for ci, hname in enumerate(ch):
                if ci not in standard and hname.strip() and not hname.lower().startswith(("label", "media", "image", "audio")):
                    choice_extra_cols[hname.strip()] = ci
            for r in crows[chi + 1:]:
                ln = str(r[li] if li is not None and li < len(r) else "").strip()
                val = str(r[ni] if ni is not None and ni < len(r) else "").strip()
                if not ln or not val:
                    continue
                c = {"value": val, "label": str(r[la] if la is not None and la < len(r) else "").strip() or val}
                c["_extra"] = {h: str(r[ci] if ci < len(r) else "").strip() for h, ci in choice_extra_cols.items()}
                lists.setdefault(ln, []).append(c)

    questions, stack_repeat, skipped_meta = [], None, []
    for i in range(hi + 1, len(rows)):
        r = rows[i]
        t = g(r, "type")
        if not t:
            continue
        rowno = i + 1
        parts = t.split()
        base = parts[0].lower()
        listname = parts[1] if len(parts) > 1 else None
        name = sanitize_name(g(r, "name") or g(r, "label") or base)
        label = g(r, "label")
        where = {"sheet": sname, "row": rowno, "q": name}
        if base in XLS_META or base in ("hidden", "xml-external", "start-geopoint"):
            skipped_meta.append(base)
            continue
        if base in ("end_group", "end group"):
            continue
        if base in ("end_repeat", "end repeat"):
            stack_repeat = None
            continue
        if base in ("begin_group", "begin group"):
            q = {"name": name, "type": "section", "label": label or name.replace("_", " ").title(), "hint": g(r, "hint"),
                 "required": False, "relevant": None, "validate": {}}
        elif base in ("begin_repeat", "begin repeat"):
            q = {"name": name, "type": "repeat", "label": label or name, "hint": g(r, "hint"), "required": False,
                 "relevant": None, "validate": {}, "children": [],
                 "repeat": {"min": None, "max": None, "item_label": "Item ${index}"}}
            rc = g(r, "repeat_count")
            if rc:
                q["repeat"]["count_expr"] = re.sub(r"\$\{(\w+)\}", r"\1", rc)
        elif base in ("select_one", "select_multiple", "rank") or base.startswith(("select_one", "select_multiple")):
            kind = "select_multiple" if base.startswith("select_multiple") else "rank" if base == "rank" else "select_one"
            q = {"name": name, "type": kind, "label": label or name, "hint": g(r, "hint"), "required": False,
                 "relevant": None, "validate": {}, "choices": []}
            if base.endswith("_from_file") or not listname:
                issues.append(Issue("warning", "choices", f"“{label or name}” takes its options from an external file — add them "
                                    "in the builder.", **where))
            elif listname not in lists:
                issues.append(Issue("error", "choices", f"The list “{listname}” isn't in the choices sheet.", **where))
            else:
                q["choices"] = [{k: v for k, v in c.items() if k != "_extra"} for c in lists[listname]]
                q["_xls_list"] = listname
        elif base in XLS_TYPES:
            kind = XLS_TYPES[base]
            q = {"name": name, "type": kind, "label": label or name, "hint": g(r, "hint"), "required": False,
                 "relevant": None, "validate": {}}
            if base == "acknowledge":
                q["choices"] = [{"value": "OK", "label": "OK"}]
            if base == "range":
                p = g(r, "params")
                for key in ("start", "end"):
                    m = re.search(rf"{key}\s*=\s*(-?[\d.]+)", p)
                    if m:
                        q["validate"]["min" if key == "start" else "max"] = _num(m[1])
            if kind == "calculate":
                f, ok = _xls_formula(g(r, "calc"), value_word=False)
                q["calc"] = f
                if not ok:
                    issues.append(Issue("warning", "calc", f"The calculation “{g(r, 'calc')}” uses XLSForm functions Kura "
                                        "doesn't have — check it in the builder.", **where))
        else:
            issues.append(Issue("warning", "question", f"XLSForm type “{t}” has no Kura equivalent — it became Short text.",
                                **where))
            q = {"name": name, "type": "text", "label": label or name, "hint": g(r, "hint"), "required": False,
                 "relevant": None, "validate": {}}
        req = g(r, "required").lower()
        if q["type"] not in DISPLAY_TYPES and req in ("yes", "true", "true()", "1"):
            q["required"] = True
        rel, ok = _xls_expr_to_rules(g(r, "relevant"))
        q["relevant"] = rel
        if not ok:
            issues.append(Issue("warning", "logic", f"Relevance “{g(r, 'relevant')}” is too complex to convert — "
                                "re-create it in the builder.", **where))
        cons = g(r, "constraint")
        if cons:
            m = re.fullmatch(r"\.\s*>=\s*(-?[\d.]+)\s+and\s+\.\s*<=\s*(-?[\d.]+)", cons)
            rm = re.fullmatch(r"regex\(\s*\.\s*,\s*['\"](.+)['\"]\s*\)", cons)
            if m:
                q["validate"]["min"], q["validate"]["max"] = _num(m[1]), _num(m[2])
            elif rm:
                q["validate"]["regex"] = rm[1]
            else:
                f, ok = _xls_formula(cons)
                q["validate"]["expr"] = f
                if not ok:
                    issues.append(Issue("warning", "calc", f"The constraint “{cons}” may not convert cleanly.", **where))
            if g(r, "cmsg"):
                q["validate"]["message"] = g(r, "cmsg")
        flt = g(r, "filter")
        if flt and q.get("_xls_list"):
            fm = re.fullmatch(r"(\w+)\s*=\s*\$\{(\w+)\}", flt.replace(" ", " ").strip())
            if fm and fm[1] in choice_extra_cols:
                q["cascade"] = {"parent": sanitize_name(fm[2])}
                for c, src in zip(q["choices"], lists[q["_xls_list"]]):
                    if src["_extra"].get(fm[1]):
                        c["parent"] = src["_extra"][fm[1]]
            else:
                issues.append(Issue("warning", "choices", f"The choice filter “{flt}” is too complex to convert.", **where))
        q.pop("_xls_list", None)
        q["_row"] = rowno
        q["_raw"] = {}
        if q["type"] == "repeat":
            questions.append(q)
            stack_repeat = q
        elif stack_repeat is not None and q["type"] != "section":
            stack_repeat["children"].append(q)
        else:
            questions.append(q)
    if skipped_meta:
        issues.append(Issue("info", "structure", f"Skipped {len(skipped_meta)} XLSForm metadata field(s) "
                            f"({', '.join(sorted(set(skipped_meta))[:5])}) — Kura records time, device and user itself.",
                            sheet=sname))
    if not questions:
        raise FormFileError("That XLSForm has no questions Kura can use.")
    title = ""
    sett = next((x for x in book.names if norm_key(x) == "settings"), None)
    if sett and len(book.sheets[sett]) > 1:
        h = [norm_key(c) for c in book.sheets[sett][0]]
        if "formtitle" in h:
            title = book.sheets[sett][1][h.index("formtitle")] if h.index("formtitle") < len(book.sheets[sett][1]) else ""
    issues.insert(0, Issue("info", "structure", "This is a Kobo / ODK XLSForm — Foon converted it to a Kura Form. "
                           "Download the converted workbook to keep editing in Kura's friendly layout.", sheet=sname))
    for q, _p in iter_questions(questions):
        q.setdefault("_show_bad", [])
        q.setdefault("_show_mixed", False)
    form = {"title": title, "description": "", "questions": questions, "indicators": [],
            "source": {"sheet": sname, "header_row": hi + 1, "letters": {}, "kind": "xlsform"}}
    return form, issues


# ─────────────────────────────────────────────────────────────────────
#  One call: read + check
# ─────────────────────────────────────────────────────────────────────

def check_file(data: bytes, filename=""):
    """Returns dict(form, issues, summary, grid, kind). Raises FormFileError."""
    book = load_book(data, filename)
    form, issues = parse_book(book)
    validate(form, issues)
    seen, unique = set(), []
    for i in issues:
        k = (i.level, i.msg, i.cell, i.row)
        if k not in seen:
            seen.add(k)
            unique.append(i)
    return {"form": form, "issues": unique, "summary": summarize(form, unique),
            "grid": xray(book, form, unique) if form["source"]["kind"] != "xlsform" else None,
            "kind": form["source"]["kind"]}


def marks_for(issues):
    out = {}
    rank = {"error": 3, "warning": 2, "fixed": 1, "info": 0}
    for i in issues:
        if not i.q or not i.key:
            continue
        k = (i.q, i.key)
        if k not in out or rank[i.level] > rank[out[k][0]]:
            out[k] = (i.level, (i.msg + (f"\n→ {i.fix}" if i.fix else "")) if i.level != "fixed" else i.msg)
    return out
