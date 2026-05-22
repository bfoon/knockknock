"""
Views for the post-event feedback feature.

Three groups:

  ORGANIZER  (login_required, owner-only)
    feedback_editor       — design the survey
    feedback_question_*   — CRUD endpoints (JSON, AJAX-friendly)
    feedback_toggle_active — activate / deactivate the survey
    feedback_results      — see submitted responses + aggregates

  PUBLIC      (no auth)
    public_feedback       — what walk-in QR / personal ticket land on
                            once the event is Ended and the survey is on.

  HELPERS
    should_route_to_feedback(event) — used by the check-in/ticket
    views to decide whether to redirect to the public survey instead.
"""

import json
from collections import Counter

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.db import transaction
from django.db.models import Avg, Max
from django.http import (
    HttpResponse, HttpResponseBadRequest, JsonResponse,
)
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST

from .models import AttendanceEvent, Registration
from .feedback_models import (
    FeedbackSurvey, FeedbackQuestion, FeedbackResponse, FeedbackAnswer,
)
from .feedback_forms import (
    FeedbackQuestionForm, build_public_feedback_form,
    parse_public_feedback_answers,
)
from .feedback_exports import (
    build_feedback_xlsx, build_feedback_docx, export_filename,
)


# ─────────────────────────── Helpers ───────────────────────────

def _own_event_or_404(user, pk):
    return get_object_or_404(AttendanceEvent, pk=pk, owner=user)


def _public_event_or_404(token):
    return get_object_or_404(AttendanceEvent, public_token=token)


def _get_or_create_survey(event):
    """Lazily create the survey row on first edit."""
    survey, _ = FeedbackSurvey.objects.get_or_create(event=event)
    return survey


def should_route_to_feedback(event):
    """
    True when the event-level scan flows should redirect to the public
    feedback page instead of their normal destinations. The check-in
    view (`public_check_in`) and the ticket view (`ticket`) both call
    this on every GET so that ending an event flips behaviour
    instantly without requiring printed QR codes to be reissued.
    """
    if event.status != AttendanceEvent.STATUS_ENDED:
        return False
    survey = getattr(event, "feedback_survey", None)
    if not (survey and survey.is_active):
        return False
    # Surveys made up of only separators (section titles, no actual
    # questions) shouldn't intercept scans — there'd be nothing for
    # the visitor to answer.
    return survey.questions.filter(
        question_type__in=FeedbackQuestion.ANSWERABLE_TYPES,
    ).exists()


def _question_to_json(q):
    return {
        "id": q.pk,
        "text": q.text,
        "question_type": q.question_type,
        "type_label": q.get_question_type_display(),
        "required": q.required,
        "choices": q.cleaned_choices(),
        "order": q.order,
    }


# ─────────────────────────── Organizer editor ───────────────────────────

@login_required
def feedback_editor(request, pk):
    """The Feedback management page linked from event detail."""
    event = _own_event_or_404(request.user, pk)
    survey = _get_or_create_survey(event)
    has_answerable = survey.questions.filter(
        question_type__in=FeedbackQuestion.ANSWERABLE_TYPES,
    ).exists()
    return render(request, "attendance/feedback_editor.html", {
        "event": event,
        "survey": survey,
        "questions": survey.questions.all(),
        "question_types": FeedbackQuestion.TYPE_CHOICES,
        "is_event_ended": event.status == AttendanceEvent.STATUS_ENDED,
        "can_accept_now": survey.can_accept_responses(),
        "response_count": survey.responses.count(),
        "has_answerable": has_answerable,
    })


@login_required
@require_POST
def feedback_survey_update(request, pk):
    """Save intro/thanks text on the survey itself (non-question fields)."""
    event = _own_event_or_404(request.user, pk)
    survey = _get_or_create_survey(event)
    survey.intro_text = (request.POST.get("intro_text") or "").strip()
    survey.thanks_text = (request.POST.get("thanks_text") or "").strip()
    survey.save(update_fields=["intro_text", "thanks_text", "updated_at"])
    messages.success(request, "Survey settings saved.")
    return redirect("attendance:feedback_editor", pk=event.pk)


@login_required
@require_POST
def feedback_toggle_active(request, pk):
    """
    Activate / deactivate the survey.

    Activation is gated on event.status == ENDED to enforce the user's
    workflow: design questions while planning, but only collect
    responses once you've ended the event.

    Deactivation is unconditional — organizers can always pause it.
    """
    event = _own_event_or_404(request.user, pk)
    survey = _get_or_create_survey(event)
    want_active = (request.POST.get("active") or "").strip() in ("1", "true", "on")

    if want_active:
        if event.status != AttendanceEvent.STATUS_ENDED:
            messages.error(
                request,
                "Feedback can only be activated after the event has been ended.",
            )
            return redirect("attendance:feedback_editor", pk=event.pk)
        has_question = survey.questions.filter(
            question_type__in=FeedbackQuestion.ANSWERABLE_TYPES,
        ).exists()
        if not has_question:
            messages.error(
                request,
                "Add at least one answerable question before activating "
                "the survey. (Section titles alone aren't enough.)",
            )
            return redirect("attendance:feedback_editor", pk=event.pk)

    survey.is_active = want_active
    survey.save(update_fields=["is_active", "updated_at"])
    messages.success(
        request,
        "Feedback survey activated — scans now land on it."
        if want_active else
        "Feedback survey paused.",
    )
    return redirect("attendance:feedback_editor", pk=event.pk)


@login_required
@require_POST
def feedback_question_add(request, pk):
    """Create a question. JSON response so the page can append it inline."""
    event = _own_event_or_404(request.user, pk)
    survey = _get_or_create_survey(event)
    form = FeedbackQuestionForm(request.POST)
    if not form.is_valid():
        return JsonResponse({
            "ok": False,
            "error": "; ".join(f"{k}: {v[0]}" for k, v in form.errors.items()),
        }, status=400)
    q = form.save(commit=False)
    q.survey = survey
    q.order = (survey.questions.aggregate(Max("order"))["order__max"] or 0) + 1
    q.save()
    return JsonResponse({"ok": True, "question": _question_to_json(q)})


@login_required
@require_POST
def feedback_question_edit(request, pk, question_id):
    event = _own_event_or_404(request.user, pk)
    survey = _get_or_create_survey(event)
    question = get_object_or_404(FeedbackQuestion, pk=question_id, survey=survey)
    form = FeedbackQuestionForm(request.POST, instance=question)
    if not form.is_valid():
        return JsonResponse({
            "ok": False,
            "error": "; ".join(f"{k}: {v[0]}" for k, v in form.errors.items()),
        }, status=400)
    form.save()
    return JsonResponse({"ok": True, "question": _question_to_json(question)})


@login_required
@require_POST
def feedback_question_delete(request, pk, question_id):
    event = _own_event_or_404(request.user, pk)
    survey = _get_or_create_survey(event)
    question = get_object_or_404(FeedbackQuestion, pk=question_id, survey=survey)
    question.delete()
    return JsonResponse({"ok": True, "deleted_id": question_id})


@login_required
@require_POST
def feedback_question_reorder(request, pk):
    """Drag-reorder. Body: {"order": [3, 1, 2]}"""
    event = _own_event_or_404(request.user, pk)
    survey = _get_or_create_survey(event)
    try:
        payload = json.loads(request.body or "{}")
        ids = payload.get("order") or []
    except ValueError:
        return HttpResponseBadRequest("Bad JSON.")
    with transaction.atomic():
        for index, qid in enumerate(ids):
            FeedbackQuestion.objects.filter(pk=qid, survey=survey).update(order=index)
    return JsonResponse({"ok": True})


# ─────────────────────────── Results ───────────────────────────

@login_required
def feedback_results(request, pk):
    """
    Per-response and per-question summary view.

    For each question we compute simple aggregates:
      open_text:        list the answers
      rate_1_5:         average + count per star
      multiple_choice:  count per option
      yes_no:           yes vs no count
    """
    event = _own_event_or_404(request.user, pk)
    survey = _get_or_create_survey(event)

    responses = (
        survey.responses
        .prefetch_related("answers__question")
        .order_by("-submitted_at")
    )

    # Build per-question aggregates.
    question_summaries = []
    for q in survey.questions.all().order_by("order", "id"):
        if q.is_separator():
            # Render in-place as a section header on the results page.
            question_summaries.append({
                "question": q,
                "kind": "separator",
            })
            continue
        answers = FeedbackAnswer.objects.filter(question=q)
        if q.question_type == FeedbackQuestion.TYPE_OPEN_TEXT:
            entries = [
                {"name": a.response.display_name(), "text": a.text_answer}
                for a in answers.select_related("response")
                if a.text_answer
            ]
            question_summaries.append({
                "question": q,
                "kind": "open_text",
                "entries": entries,
                "count": len(entries),
            })
        elif q.question_type == FeedbackQuestion.TYPE_RATE_1_5:
            buckets = Counter()
            for a in answers:
                if a.rating:
                    buckets[a.rating] += 1
            total = sum(buckets.values())
            avg = (answers.aggregate(a=Avg("rating"))["a"]) or 0
            rows = [(star, buckets.get(star, 0)) for star in range(1, 6)]
            question_summaries.append({
                "question": q,
                "kind": "rate_1_5",
                "rows": rows,
                "count": total,
                "average": round(avg, 2) if avg else 0,
            })
        elif q.question_type == FeedbackQuestion.TYPE_MULTIPLE_CHOICE:
            buckets = Counter()
            for a in answers:
                if a.choice_answer:
                    buckets[a.choice_answer] += 1
            rows = []
            for opt in q.cleaned_choices():
                rows.append((opt, buckets.get(opt, 0)))
            # Include any "other" answers somehow stored that aren't in choices
            for k, v in buckets.items():
                if k not in q.cleaned_choices():
                    rows.append((k, v))
            total = sum(v for _, v in rows)
            question_summaries.append({
                "question": q,
                "kind": "multiple_choice",
                "rows": rows,
                "count": total,
            })
        elif q.question_type == FeedbackQuestion.TYPE_YES_NO:
            yes = answers.filter(bool_answer=True).count()
            no = answers.filter(bool_answer=False).count()
            question_summaries.append({
                "question": q,
                "kind": "yes_no",
                "yes": yes,
                "no": no,
                "count": yes + no,
            })

    return render(request, "attendance/feedback_results.html", {
        "event": event,
        "survey": survey,
        "responses": responses,
        "response_count": responses.count(),
        "question_summaries": question_summaries,
    })


# ─────────────────────────── Report downloads ───────────────────────────

# Content-types for the Office Open XML formats. Spelled out here so the
# two download views below stay one-liners.
_XLSX_CT = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)
_DOCX_CT = (
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
)


def _attachment_response(data, filename, content_type):
    """Wrap raw bytes as a downloadable file response."""
    resp = HttpResponse(data, content_type=content_type)
    # quotes around the filename keep spaces / punctuation safe.
    resp["Content-Disposition"] = f'attachment; filename="{filename}"'
    resp["Content-Length"] = str(len(data))
    return resp


@login_required
def feedback_results_xlsx(request, pk):
    """Download the feedback report as an Excel workbook."""
    event = _own_event_or_404(request.user, pk)
    survey = _get_or_create_survey(event)
    data = build_feedback_xlsx(event, survey)
    return _attachment_response(
        data, export_filename(event, "xlsx"), _XLSX_CT,
    )


@login_required
def feedback_results_docx(request, pk):
    """Download the feedback report as a Word document."""
    event = _own_event_or_404(request.user, pk)
    survey = _get_or_create_survey(event)
    data = build_feedback_docx(event, survey)
    return _attachment_response(
        data, export_filename(event, "docx"), _DOCX_CT,
    )


# ─────────────────────────── Public survey ───────────────────────────

def public_feedback_by_token(request, public_token):
    """
    Entry point from the event-level walk-in QR.

    Anonymous — no Registration association. If the event isn't ended
    or the survey isn't active, we don't pretend it exists — render a
    friendly "not available" message so an organizer who scanned their
    own QR mid-event isn't confused.
    """
    event = _public_event_or_404(public_token)
    return _render_public_feedback(request, event, registration=None)


def public_feedback_by_ticket(request, token):
    """
    Entry point from a personal ticket QR. The Registration is captured
    so the organizer can see who said what.
    """
    reg = get_object_or_404(Registration, token=token)
    return _render_public_feedback(request, reg.event, registration=reg)


def _render_public_feedback(request, event, registration):
    survey = getattr(event, "feedback_survey", None)

    # Gate: event must be Ended AND survey must be active AND have questions.
    can_accept = bool(
        survey
        and survey.is_active
        and survey.questions.exists()
        and event.status == AttendanceEvent.STATUS_ENDED
    )
    if not can_accept:
        return render(request, "attendance/feedback_unavailable.html", {
            "event": event,
        }, status=403)

    if request.method == "POST":
        form = build_public_feedback_form(survey, data=request.POST)
        if form.is_valid():
            with transaction.atomic():
                response = FeedbackResponse.objects.create(
                    survey=survey,
                    registration=registration,
                    submitter_name=(registration.full_name if registration else ""),
                )
                rows = parse_public_feedback_answers(form, survey)
                FeedbackAnswer.objects.bulk_create([
                    FeedbackAnswer(
                        response=response,
                        question=q,
                        **values,
                    )
                    for q, values in rows
                ])
            return render(request, "attendance/feedback_thanks.html", {
                "event": event,
                "survey": survey,
                "thanks_text": survey.thanks_text or "Thanks for your feedback!",
            })
    else:
        form = build_public_feedback_form(survey)

    # Walk the questions once, pairing answerable questions with their
    # BoundField on the dynamic form and emitting separator markers
    # in-place. The template iterates this list rather than `form` so
    # section titles appear at the right position relative to the
    # questions that follow them.
    form_items = []
    for q in survey.questions.all().order_by("order", "id"):
        if q.is_separator():
            form_items.append({"is_separator": True, "text": q.text})
        else:
            field_name = f"q_{q.pk}"
            bound = form[field_name] if field_name in form.fields else None
            if bound is not None:
                form_items.append({"is_separator": False, "field": bound})

    return render(request, "attendance/feedback_public.html", {
        "event": event,
        "survey": survey,
        "form": form,
        "form_items": form_items,
        "questions": survey.questions.all(),
        "registration": registration,
    })