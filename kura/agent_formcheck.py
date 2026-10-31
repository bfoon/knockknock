"""
kura/agent_formcheck.py — Foon checks an Excel questionnaire before it
becomes a survey.

Flow
────
1. The user drops a workbook on Foon (or presses 📎) — or asks Foon to check
   its own draft. `start_*` reads and checks it with kura/kura_form.py and
   keeps the result in a short-lived CHECK SESSION (Django cache, 3 hours,
   owned by that user).
2. Foon shows a "Form check" block: score, verdict, an x-ray of the
   Questions sheet with every problem cell marked, the issues with fixes.
3. "Fix for me" runs the safe fixes in rounds, then RE-CHECKS THE FIXED
   WORKBOOK ITSELF — the exact file the user will download or import — so
   what the block says is what the file is.
4. "Create survey" only works once the chosen version has no errors; the
   survey is built from the checked session on the server, never from
   whatever the browser sends back.

Downloads: the user's own workbook marked up (coloured, commented cells and
a "Foon check" sheet), the fixed workbook, or a clean Kura Form (handy for a
converted Kobo/ODK XLSForm or a CSV).
"""

from __future__ import annotations

import os
import secrets

from django.core.cache import cache

from . import kura_form as kf

TTL = 3 * 3600
LEVEL_ORDER = {"error": 0, "warning": 1, "fixed": 2, "info": 3}


class CheckError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def _key(token):
    return f"foon-form:{token}"


def load(user, token):
    entry = cache.get(_key(str(token or "")[:40])) if token else None
    if not entry or entry.get("user") != getattr(user, "pk", None):
        raise CheckError("That check has expired — drop the file on me again.", status=404)
    return entry


def _save(token, entry):
    cache.set(_key(token), entry, TTL)


def _stem(filename):
    base = os.path.splitext(os.path.basename(filename or ""))[0]
    text = " ".join(base.replace("_", " ").replace("-", " ").split())[:120]
    return (text[:1].upper() + text[1:]) if text else "Imported survey"


# ─────────────────────────────────────────────────────────────────────
#  Starting a check
# ─────────────────────────────────────────────────────────────────────

def start_from_file(user, data, filename):
    try:
        res = kf.check_file(data, filename)
    except kf.FormFileError as exc:
        raise CheckError(str(exc))
    token = secrets.token_urlsafe(18)
    entry = {"user": user.pk, "filename": filename or "questionnaire.xlsx", "kind": res["kind"],
             "data": data if res["kind"] == "xlsx" else None,
             "form": res["form"], "issues": res["issues"], "summary": res["summary"], "grid": res["grid"],
             "fixed": None}
    _save(token, entry)
    return token, entry


def start_from_questions(user, title, description, questions):
    """Foon checks its own draft: write the Kura Form, then read it back with
    the same importer — a true round trip, not a shortcut."""
    from .agent_engine import sanitize_questions
    qs = sanitize_questions(questions)
    if not qs:
        raise CheckError("There are no questions to check.")
    data = kf.build_workbook(title or "", description or "", qs, [])
    name = (kf.sanitize_name(title) or "foon_draft") + "_kura_form.xlsx"
    token, entry = start_from_file(user, data, name)
    entry["kind"] = "draft"
    _save(token, entry)
    return token, entry


# ─────────────────────────────────────────────────────────────────────
#  Fixing
# ─────────────────────────────────────────────────────────────────────

def _fixed_bundle(entry):
    """Fix in rounds, write the fixed workbook, re-check THAT file, then write
    it once more with green 'Foon fixed' cells and the Foon check sheet."""
    fixed_form, applied, _remaining = kf.fix_all(entry["form"], entry["issues"])
    questions = kf.to_schema_questions(fixed_form)
    title = fixed_form.get("title") or _stem(entry["filename"])
    plain = kf.build_workbook(title, fixed_form.get("description", ""), questions, fixed_form.get("indicators") or [])
    res = kf.check_file(plain, "fixed.xlsx")
    rows = {q["name"]: q.get("_row") for q, _p in kf.iter_questions(res["form"]["questions"])}
    letters = res["form"]["source"]["letters"]
    sheet = res["form"]["source"]["sheet"]
    mapped = []
    for a in applied:
        row = rows.get(a.q)
        mapped.append(kf.Issue("fixed", a.cat, a.msg, sheet=sheet, row=row, key=a.key, q=a.q,
                               cell=f"{letters[a.key]}{row}" if row and a.key in letters else None))
    notes = mapped + res["issues"]
    final = kf.build_workbook(title, fixed_form.get("description", ""), questions, fixed_form.get("indicators") or [],
                              marks=kf.marks_for(notes), notes=notes)
    book = kf.load_book(final, "fixed.xlsx")
    grid = kf.xray(book, res["form"], [i for i in notes if i.level != "info"] + [i for i in res["issues"] if i.level == "info"])
    summary = kf.summarize(res["form"], res["issues"])
    summary["fixed"] = len(mapped)
    return {"form": res["form"], "issues": res["issues"], "applied": mapped, "summary": summary, "grid": grid,
            "data": final, "title": title}


def fix(user, token):
    entry = load(user, token)
    if not entry.get("fixed"):
        entry["fixed"] = _fixed_bundle(entry)
        _save(token, entry)
    return entry


# ─────────────────────────────────────────────────────────────────────
#  The block Foon shows
# ─────────────────────────────────────────────────────────────────────

def _issues_out(issues, limit=120):
    out = [i.public() for i in sorted(issues, key=lambda i: (LEVEL_ORDER.get(i.level, 9), i.row or 0))]
    return out[:limit]


def block(token, entry, variant="original"):
    v = entry["fixed"] if variant == "fixed" and entry.get("fixed") else None
    form = v["form"] if v else entry["form"]
    issues = v["issues"] if v else entry["issues"]
    summary = v["summary"] if v else entry["summary"]
    title = (v or {}).get("title") or form.get("title") or _stem(entry["filename"])
    return {
        "type": "formcheck", "token": token, "variant": "fixed" if v else "original",
        "title": title, "description": form.get("description", ""),
        "filename": entry["filename"], "kind": entry["kind"],
        "summary": summary, "issues": _issues_out(issues),
        "applied": _issues_out(v["applied"]) if v else [],
        "grid": v["grid"] if v else entry["grid"],
        "questions": kf.to_schema_questions(form),
        "indicators": form.get("indicators") or [],
        "has_original": bool(entry.get("data")),
        "spec": None,
    }


def _n(count, word):
    return f"{count} {word}{'' if count == 1 else 's'}"


def say_for(entry, variant="original"):
    v = entry["fixed"] if variant == "fixed" and entry.get("fixed") else None
    s = (v or entry)["summary"]
    c, st = s["counts"], s["stats"]
    if v:
        head = f"I fixed **{_n(s.get('fixed', 0), 'thing')}** and re-checked the fixed workbook."
        if c["error"]:
            return head + f" **{_n(c['error'], 'problem')}** still need you — they're marked in red, each with a suggestion."
        return head + " It's clean now — ready to become a survey."
    kind = {"xlsform": "Kobo/ODK XLSForm (converted)", "csv": "CSV", "draft": "draft"}.get(entry["kind"], "workbook")
    head = (f"I checked every cell of your {kind}: {_n(st['questions'], 'question')}, {st['logic']} with skip logic, "
            f"about {st['minutes']} min to answer.")
    if entry["kind"] == "draft":
        head = f"I wrote my draft as a Kura Form and read it back like the builder would: {_n(st['questions'], 'question')}."
    if c["error"]:
        tail = f" **{_n(c['error'], 'problem')}** would break or change the survey"
        tail += f", and I can fix {s['fixable']} of them for you." if s["fixable"] else " — the cells are marked below."
        return head + tail
    if c["warning"]:
        return head + f" No errors, so it can become a survey now; {_n(c['warning'], 'thing')} worth a look first."
    return head + " Everything checks out — it's ready to become a survey."


def mood_for(entry, variant="original"):
    v = entry["fixed"] if variant == "fixed" and entry.get("fixed") else None
    s = (v or entry)["summary"]
    return "proud" if s["ready"] else ("curious" if s["fixable"] else "thinking")


def suggestions_for(entry, variant="original"):
    v = entry["fixed"] if variant == "fixed" and entry.get("fixed") else None
    s = (v or entry)["summary"]
    if s["ready"]:
        return ["Review the wording too", "Make the questions simpler"]
    return ["Explain the first problem", "How do I write skip logic?"]


# ─────────────────────────────────────────────────────────────────────
#  Downloads and creating the survey
# ─────────────────────────────────────────────────────────────────────

def export_checked(user, spec, fmt):
    from .agent_export import CONTENT_TYPES, ExportError
    try:
        entry = load(user, spec.get("token"))
    except CheckError as exc:
        raise ExportError(str(exc))
    stem = kf.sanitize_name(_stem(entry["filename"])) or "questionnaire"
    variant = spec.get("variant")
    if variant == "marked":
        if not entry.get("data"):
            raise ExportError("Only an .xlsx file can be marked up — download the Kura Form version instead.")
        return kf.markup_original(entry["data"], entry["issues"]), f"{stem}_foon_checked.xlsx", CONTENT_TYPES["xlsx"]
    if variant == "fixed":
        entry = fix(user, spec.get("token"))
        return entry["fixed"]["data"], f"{stem}_foon_fixed.xlsx", CONTENT_TYPES["xlsx"]
    form = entry["form"]
    data = kf.build_workbook(form.get("title") or _stem(entry["filename"]), form.get("description", ""),
                             kf.to_schema_questions(form), form.get("indicators") or [])
    return data, f"{stem}_kura_form.xlsx", CONTENT_TYPES["xlsx"]


def create_survey(user, token, variant="original", title=None):
    from .models import Survey
    entry = load(user, token)
    v = entry["fixed"] if variant == "fixed" and entry.get("fixed") else None
    form = v["form"] if v else entry["form"]
    summary = v["summary"] if v else entry["summary"]
    if not summary["ready"]:
        n = summary["counts"]["error"]
        raise CheckError(f"Fix the {n} problem(s) first — a survey built from this file would break or behave differently.")
    questions = kf.to_schema_questions(form)
    schema = {"settings": {"anonymous": True, "shuffle_questions": False, "languages": ["en"]}, "questions": questions}
    if form.get("indicators"):
        schema["indicators"] = form["indicators"]
    survey = Survey.objects.create(
        owner=user, title=(title or (v or {}).get("title") or form.get("title") or _stem(entry["filename"]))[:140],
        description=str(form.get("description") or "")[:2000], draft_schema=schema)
    return survey, len(questions)


def prompt_context(user, token):
    """What the AI may see about the uploaded questionnaire: wording and
    structure (no respondent data exists in a questionnaire)."""
    try:
        entry = load(user, token)
    except CheckError:
        return None
    v = entry.get("fixed")
    form = (v or entry)["form"]
    issues = (v or entry)["issues"]
    lines = [f"UPLOADED QUESTIONNAIRE: “{entry['filename']}” ({entry['kind']}) — "
             f"{(v or entry)['summary']['counts']['error']} error(s), {(v or entry)['summary']['counts']['warning']} warning(s)"
             + (" after Foon's fixes" if v else "") + "."]
    for i, (q, parent) in enumerate(kf.iter_questions(form["questions"])):
        if i >= 120:
            lines.append("…")
            break
        opts = ", ".join(str(c.get("label")) for c in (q.get("choices") or [])[:8])
        lines.append(f"{'    ' if parent else ''}- {q['name']} [{q['type']}]{' *' if q.get('required') else ''} "
                     f"{q.get('label', '')[:120]}" + (f" {{{opts}}}" if opts else "") +
                     (f" [show when {kf.show_when_text(q.get('relevant'))}]" if q.get("relevant") else ""))
    probs = [i for i in issues if i.level in ("error", "warning")][:12]
    if probs:
        lines.append("OPEN PROBLEMS: " + " | ".join(f"{i.cell or ''} {i.msg}" for i in probs))
    lines.append("To improve or rewrite it, use the questionnaire tool (the user can then download it as Excel, "
                 "re-check it, and create the survey).")
    return "\n".join(lines)
