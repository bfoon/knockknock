import json
from collections import Counter

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.db import transaction
from django.db.models import Count
from django.http import HttpResponse, HttpResponseBadRequest, JsonResponse, HttpResponseForbidden
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.utils.encoding import iri_to_uri
from django.utils.http import url_has_allowed_host_and_scheme
from django.utils.text import slugify
from django.views.decorators.http import require_POST

from core.templates_registry import TEMPLATES, get_template
from presentations.models import LiveSession, Participant

from .charts import ALL_CHARTS, curated_charts_for
from .forms import (
    ChoiceFormSet,
    CONFIG_FORM_BY_TYPE,
    MatrixRowFormSet,
    QuestionForm,
    QuestionnaireForm,
)
from .exports import ReportData, QuestionResult, build_excel_report, build_word_report
from .models import (
    Choice,
    MatrixAnswer,
    MatrixRow,
    PointsAllocation,
    Question,
    Questionnaire,
    QuestionnaireCollaborator,
    Response,
)
from .question_types import QUESTION_TYPE_REGISTRY

import logging
logger = logging.getLogger(__name__)

def _safe_next(request, fallback_url_name):
    """Resolve a `next` parameter without opening a redirect hole.

    The old check was `nxt.startswith("/")`, which accepts `//evil.example.com/`
    — browsers read that as protocol-relative and leave the site.
    """
    nxt = request.POST.get("next") or ""
    if nxt and url_has_allowed_host_and_scheme(
        url=nxt, allowed_hosts={request.get_host()}, require_https=request.is_secure()
    ):
        return redirect(iri_to_uri(nxt))
    return redirect(fallback_url_name)


def _jsonable(value):
    """Coerce a config form's cleaned_data into something JSONField accepts."""
    import datetime
    import decimal

    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if isinstance(value, decimal.Decimal):
        return float(value)
    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
        return value.isoformat()
    return value


def _seed_default_choices(question):
    """Seed a couple of starter choices for choice-storage types."""
    meta = QUESTION_TYPE_REGISTRY.get(question.type, {})
    if not meta.get("has_choices"):
        return
    auto = meta.get("auto_choices")
    if auto:
        for i, label in enumerate(auto):
            Choice.objects.create(question=question, text=label, order=i)
    else:
        for i, t in enumerate(["Option 1", "Option 2"]):
            Choice.objects.create(question=question, text=t, order=i)


# ── List / create / edit (questionnaire-level) ─────────────────────────
@login_required
def list_view(request):
    qs = (
        Questionnaire.objects
        .filter(owner=request.user)
        .annotate(num_questions=Count("questions", distinct=True))
    )
    return render(request, "polls/list.html", {"questionnaires": qs})


@login_required
def create(request):
    if request.method == "POST":
        form = QuestionnaireForm(request.POST, request.FILES)
        if form.is_valid():
            q = form.save(commit=False)
            q.owner = request.user
            if request.POST.get("template_id"):
                q.template_id = request.POST["template_id"]
            q.save()
            messages.success(request, "Questionnaire created.")
            return redirect("polls:edit", pk=q.pk)
    else:
        form = QuestionnaireForm()
    return render(request, "polls/create.html", {
        "form": form,
        "templates": TEMPLATES,
        "selected_template_id": request.POST.get("template_id") or "space_hud",
    })


@login_required
def edit(request, pk):
    questionnaire = get_object_or_404(Questionnaire, pk=pk)
    if not questionnaire.can_edit(request.user):
        return HttpResponseForbidden("You don't have access to this questionnaire.")
    is_owner = questionnaire.owner_id == request.user.id

    if request.method == "POST":
        form = QuestionnaireForm(request.POST, request.FILES, instance=questionnaire)
        if form.is_valid():
            form.save()
            messages.success(request, "Saved.")
            return redirect("polls:edit", pk=pk)
    else:
        form = QuestionnaireForm(instance=questionnaire)

    from .question_types import grouped_for_picker

    questions = list(questionnaire.questions.all())

    return render(request, "polls/edit.html", {
        "questionnaire": questionnaire,
        "form": form,
        "templates": TEMPLATES,
        "selected_template": get_template(questionnaire.template_id),
        "is_owner": is_owner,
        "collaborators": list(questionnaire.collaborators.select_related("user")),
        # The template iterated `questionnaire.questions.all` directly and
        # called `.count` three separate times, so the header alone cost
        # three COUNT queries before the list was even rendered.
        "questions": questions,
        "question_count": len(questions),
        # Drives the quick-add dropdown, which used to be a hand-maintained
        # copy of the registry that had already fallen out of sync.
        "grouped_qtypes": grouped_for_picker(),
    })


@login_required
@require_POST
def set_template(request, pk):
    q = get_object_or_404(Questionnaire, pk=pk)
    if not q.can_edit(request.user):
        return HttpResponseForbidden("You don't have access to this questionnaire.")
    q.template_id = request.POST.get("template_id", q.template_id)
    q.save(update_fields=["template_id"])
    return JsonResponse({"ok": True})


# ── Questions ─────────────────────────────────────────────────────────
@login_required
def question_create(request, pk):
    questionnaire = get_object_or_404(Questionnaire, pk=pk)
    if not questionnaire.can_edit(request.user):
        return HttpResponseForbidden("You don't have access to this questionnaire.")

    qtype = request.GET.get("type") or "mcq"
    if qtype not in QUESTION_TYPE_REGISTRY:
        qtype = "mcq"
    meta = QUESTION_TYPE_REGISTRY[qtype]

    q = Question.objects.create(
        questionnaire=questionnaire,
        text="New question",
        order=questionnaire.questions.count(),
        type=qtype,
        chart_type=meta.get("default_chart", "bar"),
    )
    # This used to hardcode MCQ and write "Option 1"/"Option 2" inline,
    # ignoring both `?type=` and _seed_default_choices — so creating a Yes/No
    # question from the full editor gave you two blank options instead of
    # Yes and No.
    _seed_default_choices(q)
    return redirect("polls:question_edit", pk=questionnaire.pk, qpk=q.pk)


@login_required
def question_edit(request, pk, qpk):
    questionnaire = get_object_or_404(Questionnaire, pk=pk)
    if not questionnaire.can_edit(request.user):
        return HttpResponseForbidden("You don't have access to this questionnaire.")
    question = get_object_or_404(Question, pk=qpk, questionnaire=questionnaire)
    meta = QUESTION_TYPE_REGISTRY.get(question.type, {})

    ConfigFormClass = CONFIG_FORM_BY_TYPE.get(question.type)

    if request.method == "POST":
        form = QuestionForm(request.POST, request.FILES, instance=question)
        formset = ChoiceFormSet(request.POST, request.FILES, instance=question) \
            if meta.get("has_choices") else None
        matrix_rows = MatrixRowFormSet(request.POST, instance=question) \
            if question.type == "matrix" else None
        config_form = ConfigFormClass(request.POST, prefix="cfg") \
            if ConfigFormClass else None
        skip_rules_json = request.POST.get("skip_rules_json", "")

        # ── Validate everything BEFORE branching, so we collect all errors ──
        form_ok = form.is_valid()
        formset_ok = formset.is_valid() if formset is not None else True
        matrix_ok = matrix_rows.is_valid() if matrix_rows is not None else True
        config_ok = config_form.is_valid() if config_form is not None else True

        if not (form_ok and formset_ok and matrix_ok and config_ok):
            # This block used to print() every error dict to stdout and push the
            # raw `form.errors` structure into a messages.error banner, so a
            # blank choice label showed the author something like
            #   Choice errors: [{}, {'text': ['This field is required.']}]
            # Each field renders its own error; this is only the summary.
            logger.info(
                "polls.question_edit rejected q=%s form=%s choices=%s matrix=%s config=%s",
                question.pk, form_ok, formset_ok, matrix_ok, config_ok,
            )
            messages.error(request, "This question wasn\u2019t saved \u2014 see the notes below.")

        skip_rules = []
        if skip_rules_json.strip():
            try:
                parsed = json.loads(skip_rules_json)
                if not isinstance(parsed, list):
                    raise ValueError("skip_rules must be a list")
                skip_rules = parsed
            except (ValueError, json.JSONDecodeError):
                form_ok = False
                messages.error(request, "The branching rules on this question are malformed.")

        forms_ok = form_ok and formset_ok and matrix_ok and config_ok

        if forms_ok:
            q = form.save(commit=False)
            q.skip_rules = skip_rules
            if config_form is not None:
                # cleaned_data can hold date/time/Decimal objects and a
                # JSONField cannot serialise those — the save would fail with
                # "Object of type date is not JSON serializable".
                q.config = _jsonable(config_form.cleaned_data)
            q.save()
            if formset is not None:
                formset.save()
            if matrix_rows is not None:
                matrix_rows.save()
            _auto_seed_choices_if_empty(q)
            messages.success(request, "Question saved.")
            return redirect("polls:edit", pk=questionnaire.pk)
    else:
        form = QuestionForm(instance=question)
        formset = ChoiceFormSet(instance=question) if meta.get("has_choices") else None
        matrix_rows = MatrixRowFormSet(instance=question) if question.type == "matrix" else None
        config_form = ConfigFormClass(initial=question.config, prefix="cfg") \
            if ConfigFormClass else None

    curated = curated_charts_for(question.type)
    curated_ids = {cid for cid, _ in curated}

    from .question_types import grouped_for_picker

    return render(request, "polls/question_edit.html", {
        "questionnaire": questionnaire,
        "question": question,
        "form": form,
        "formset": formset,
        "matrix_rows": matrix_rows,
        "config_form": config_form,
        "meta": meta,
        "curated_charts": curated,
        "curated_chart_ids": curated_ids,
        "all_charts": list(ALL_CHARTS.items()),
        "grouped_qtypes": grouped_for_picker(),
        "skip_rules_json": json.dumps(question.skip_rules or []),
        "siblings": list(questionnaire.questions.exclude(pk=question.pk).order_by("order")),
    })

def _auto_seed_choices_if_empty(question):
    """If a type has `auto_choices` in its registry entry and no choices exist, seed them."""
    meta = QUESTION_TYPE_REGISTRY.get(question.type, {})
    auto = meta.get("auto_choices")
    if not auto or not meta.get("has_choices"):
        return
    if question.choices.exists():
        return
    for i, label in enumerate(auto):
        Choice.objects.create(question=question, text=label, order=i)


@login_required
@require_POST
def change_type(request, pk, qpk):
    """
    Handle changing a question's type. Resets chart_type to the new type's
    default, optionally seeds auto_choices, and clears stale type-specific
    storage (matrix_rows, points allocations) when switching away.
    """
    questionnaire = get_object_or_404(Questionnaire, pk=pk)
    if not questionnaire.can_edit(request.user):
        return HttpResponseForbidden("You don't have access to this questionnaire.")
    question = get_object_or_404(Question, pk=qpk, questionnaire=questionnaire)

    new_type = request.POST.get("type")
    if new_type not in QUESTION_TYPE_REGISTRY:
        return HttpResponseBadRequest("Unknown type.")
    meta = QUESTION_TYPE_REGISTRY[new_type]

    old_type = question.type
    question.type = new_type
    question.chart_type = meta.get("default_chart", "bar")
    question.config = {}  # reset type-specific config
    question.save(update_fields=["type", "chart_type", "config"])

    # Clean up: if switching away from a type that uses unique storage,
    # drop the now-stale rows.
    if old_type == "matrix" and new_type != "matrix":
        question.matrix_rows.all().delete()

    # Auto-choice types such as yes/no, likert, and reaction must replace
    # stale placeholder choices like "Option 1" / "Option 2". Without this,
    # the participant side can show the wrong buttons or no useful emoji
    # answers after changing an existing question into a reaction question.
    auto_choices = meta.get("auto_choices") or []
    if auto_choices:
        question.choices.all().delete()
        for i, label in enumerate(auto_choices):
            Choice.objects.create(question=question, text=label, order=i)
    elif not meta.get("has_choices"):
        question.choices.all().delete()
    else:
        _auto_seed_choices_if_empty(question)

    return redirect("polls:question_edit", pk=questionnaire.pk, qpk=question.pk)


@login_required
@require_POST
def question_delete(request, pk, qpk):
    questionnaire = get_object_or_404(Questionnaire, pk=pk)
    if not questionnaire.can_edit(request.user):
        return HttpResponseForbidden("You don't have access to this questionnaire.")
    Question.objects.filter(pk=qpk, questionnaire=questionnaire).delete()
    return redirect("polls:edit", pk=pk)


@login_required
@require_POST
def reorder_questions(request, pk):
    questionnaire = get_object_or_404(Questionnaire, pk=pk)
    if not questionnaire.can_edit(request.user):
        return HttpResponseForbidden("You don't have access to this questionnaire.")
    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
        ids = [int(x) for x in payload.get("order", [])]
    except (ValueError, json.JSONDecodeError):
        return HttpResponseBadRequest("Invalid payload.")

    existing = {q.pk for q in questionnaire.questions.all()}
    if set(ids) != existing:
        # Usually means the deck was edited in another tab. 409 lets the
        # client tell the user to reload instead of showing "Bad Request".
        return JsonResponse(
            {"ok": False, "error": "This list is out of date. Reload the page."},
            status=409,
        )

    by_id = {q.pk: q for q in questionnaire.questions.all()}
    changed = []
    for new_order, qpk in enumerate(ids):
        q = by_id[qpk]
        if q.order != new_order:
            q.order = new_order
            changed.append(q)
    if changed:
        Question.objects.bulk_update(changed, ["order"])
    return JsonResponse({"ok": True, "updated": len(changed)})


# ── Live session ──────────────────────────────────────────────────────
@login_required
@require_POST
def start_session(request, pk):
    questionnaire = get_object_or_404(Questionnaire, pk=pk)
    if not questionnaire.can_edit(request.user):
        return HttpResponseForbidden("You don't have access to this questionnaire.")
    session = LiveSession.objects.create(
        owner=request.user, kind="poll",
        questionnaire=questionnaire, mode=questionnaire.mode,
    )
    return redirect("presentations:present", code=session.code)


# ── Collaboration ─────────────────────────────────────────────────────
# Invitation is handled by the generic `collaborations` app (kind="menti").
# This view just redirects so the polls:invite URL name and any in-page
# "Invite collaborators" links keep working.
@login_required
def invite_collaborator(request, pk):
    # Ownership is re-checked inside the collaborations.invite view.
    return redirect("collaborations:invite", kind="menti", target_id=pk)


@login_required
@require_POST
def remove_collaborator(request, pk, cpk):
    questionnaire = get_object_or_404(Questionnaire, pk=pk, owner=request.user)
    # Remove from BOTH tables so the generic collaborations app stays in sync.
    qc = QuestionnaireCollaborator.objects.filter(
        pk=cpk, questionnaire=questionnaire,
    ).first()
    if qc is not None:
        removed_user_id = qc.user_id
        qc.delete()
        # Mirror the removal in the generic table.
        from collaborations.models import Collaborator as GenericCollaborator
        GenericCollaborator.objects.filter(
            user_id=removed_user_id, kind="menti", target_id=pk,
        ).delete()
    return redirect("polls:edit", pk=pk)



# ── Results / export / reset ─────────────────────────────────────────
def _result_sessions_for(questionnaire):
    """All live poll sessions for this questionnaire, newest first."""
    return (
        LiveSession.objects
        .filter(kind="poll", questionnaire=questionnaire)
        .order_by("-created_at")
    )


def _selected_result_session(request, questionnaire):
    """Pick the session requested by ?session=CODE, or latest by default.

    Returns (selected_session, selected_code, sessions_qs).
    selected_session is None only when selected_code == "all".
    """
    sessions = _result_sessions_for(questionnaire)
    selected_code = (
        request.GET.get("session")
        or request.POST.get("session")
        or ""
    ).strip()

    if selected_code == "all":
        return None, "all", sessions

    if selected_code:
        selected = sessions.filter(code=selected_code).first()
        if selected:
            return selected, selected.code, sessions

    selected = sessions.first()
    return selected, selected.code if selected else "", sessions


def _sessions_for_report(questionnaire, selected_session):
    if selected_session is None:
        return list(_result_sessions_for(questionnaire))
    return [selected_session]


def _storage_for(question):
    try:
        return question.storage() or ""
    except Exception:
        return ""


def _report_qtype_for(question):
    """Map Knock-Knock question/storage types into the export module types."""
    qtype = (question.type or "mcq").lower()
    storage = _storage_for(question)

    if qtype in {"mcq", "word", "scale", "open", "ranking"}:
        return qtype

    if qtype in {"reaction", "yes_no", "likert", "image_choice"}:
        return "mcq"

    if qtype in {"points_allocation"} or storage == "points":
        return "ranking"

    if qtype in {"rating", "nps", "slider", "numeric"} or storage == "numeric":
        return "scale"

    if qtype in {"wordcloud"}:
        return "word"

    if storage in {"choice", "multi_choice"} or question.has_choices():
        return "mcq"

    return "open"


def _chart_for_report(question, report_qtype):
    chart = (question.chart_type or "bar").lower()

    if report_qtype == "word":
        return "wordcloud"
    if report_qtype == "open":
        return "responses_list"
    if report_qtype == "scale":
        return "histogram"
    if report_qtype == "ranking":
        return "ranked_bar"
    if chart in {"bar", "pie", "donut", "doughnut", "line"}:
        return chart
    return "bar"


def _question_result(question, sessions):
    report_qtype = _report_qtype_for(question)
    chart_type = _chart_for_report(question, report_qtype)
    storage = _storage_for(question)

    choices = list(question.choices.all().order_by("order", "id"))
    options = [choice.text for choice in choices]
    choice_index = {choice.id: index for index, choice in enumerate(choices)}
    counts = [0 for _choice in choices]

    responses = list(
        Response.objects
        .filter(question=question, session__in=sessions)
        .select_related("choice")
        .order_by("created_at")
    )

    for response in responses:
        if response.choice_id in choice_index:
            counts[choice_index[response.choice_id]] += 1

    if report_qtype in {"mcq", "ranking"}:
        # Points allocation stores points in a separate table.
        if storage == "points" or (question.type or "").lower() == "points_allocation":
            counts = [0 for _choice in choices]
            allocations = (
                PointsAllocation.objects
                .filter(question=question, session__in=sessions)
                .select_related("choice")
            )
            for allocation in allocations:
                if allocation.choice_id in choice_index:
                    counts[choice_index[allocation.choice_id]] += int(allocation.points or 0)
            report_qtype = "ranking"
            chart_type = "ranked_bar"

        # Avoid export crashes if an old/broken choice question has no choices.
        if not options:
            options = ["No options"]
            counts = [0]

        return QuestionResult(
            text=question.text,
            qtype=report_qtype,
            chart_type=chart_type,
            options=options,
            counts=counts,
        )

    if report_qtype == "scale":
        scale_values = [
            float(response.numeric_value)
            for response in responses
            if response.numeric_value is not None
        ]
        return QuestionResult(
            text=question.text,
            qtype="scale",
            chart_type=chart_type,
            scale_values=scale_values,
        )

    if report_qtype == "word":
        words = [
            (response.text_value or "").strip()
            for response in responses
            if (response.text_value or "").strip()
        ]
        return QuestionResult(
            text=question.text,
            qtype="word",
            chart_type="wordcloud",
            words=words,
        )

    open_answers = [
        (response.text_value or "").strip()
        for response in responses
        if (response.text_value or "").strip()
    ]

    if storage == "matrix" or (question.type or "").lower() == "matrix":
        open_answers = [
            f"{answer.matrix_row.text}: {answer.numeric_value:g}"
            for answer in (
                MatrixAnswer.objects
                .filter(question=question, session__in=sessions)
                .select_related("matrix_row")
                .order_by("matrix_row__order", "created_at")
            )
        ]

    return QuestionResult(
        text=question.text,
        qtype="open",
        chart_type="responses_list",
        open_answers=open_answers,
    )


def _build_report_data(questionnaire, selected_session):
    sessions = _sessions_for_report(questionnaire, selected_session)
    session_code = selected_session.code if selected_session else "ALL"

    questions = [
        _question_result(question, sessions)
        for question in questionnaire.questions.all().order_by("order", "id")
    ]

    if sessions:
        started_at = min(session.created_at for session in sessions)
        ended_dates = [session.ended_at for session in sessions if session.ended_at]
        ended_at = max(ended_dates) if ended_dates else None
        mode = selected_session.mode if selected_session else "all"
        participant_count = (
            Participant.objects
            .filter(session__in=sessions)
            .values("participant_uid")
            .distinct()
            .count()
        )
    else:
        started_at = getattr(questionnaire, "created_at", timezone.now())
        ended_at = None
        mode = questionnaire.mode
        participant_count = 0

    owner = questionnaire.owner
    owner_name = owner.get_full_name() or getattr(owner, "username", "") or str(owner)

    return ReportData(
        title=questionnaire.title,
        description=questionnaire.description or "",
        owner_name=owner_name,
        session_code=session_code,
        mode=mode,
        started_at=started_at,
        ended_at=ended_at,
        participant_count=participant_count,
        questions=questions,
    )


def _cards_from_report(report_data):
    cards = []

    for number, result in enumerate(report_data.questions, start=1):
        total = max(int(result.total_responses or 0), 0)
        rows = []

        for label, count in zip(result.options, result.counts):
            rows.append({
                "label": label,
                "count": int(count or 0),
                "percent": (int(count or 0) / total * 100) if total else 0,
            })

        words = []
        if result.words:
            words = [
                {"label": word, "count": count}
                for word, count in Counter(
                    word.lower().strip()
                    for word in result.words
                    if word.strip()
                ).most_common(30)
            ]

        scale_counts = []
        if result.scale_values:
            counter = Counter(int(round(value)) for value in result.scale_values)
            for value in range(min(counter), max(counter) + 1):
                scale_counts.append({"value": value, "count": counter.get(value, 0)})

        cards.append({
            "number": number,
            "result": result,
            "rows": rows,
            "words": words,
            "texts": result.open_answers[:300],
            "scale_counts": scale_counts,
        })

    return cards


def _download_filename(questionnaire, selected_code, extension):
    base = slugify(questionnaire.title or "knock-knock-results") or "knock-knock-results"
    suffix = selected_code or "latest"
    return f"{base}-{suffix}.{extension}"


@login_required
def questionnaire_results(request, pk):
    questionnaire = get_object_or_404(Questionnaire, pk=pk)
    if not questionnaire.can_edit(request.user):
        return HttpResponseForbidden("You don't have access to this questionnaire.")

    selected_session, selected_code, sessions = _selected_result_session(request, questionnaire)
    report = _build_report_data(questionnaire, selected_session)

    return render(request, "polls/results.html", {
        "questionnaire": questionnaire,
        "sessions": sessions,
        "selected_session": selected_session,
        "selected_code": selected_code,
        "report": report,
        "cards": _cards_from_report(report),
        "total_responses": sum(q.total_responses for q in report.questions),
    })


@login_required
def download_results_excel(request, pk):
    questionnaire = get_object_or_404(Questionnaire, pk=pk)
    if not questionnaire.can_edit(request.user):
        return HttpResponseForbidden("You don't have access to this questionnaire.")

    selected_session, selected_code, _sessions = _selected_result_session(request, questionnaire)
    report = _build_report_data(questionnaire, selected_session)
    payload = build_excel_report(report)

    response = HttpResponse(
        payload,
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    response["Content-Disposition"] = (
        f'attachment; filename="{_download_filename(questionnaire, selected_code, "xlsx")}"'
    )
    return response


@login_required
def download_results_word(request, pk):
    questionnaire = get_object_or_404(Questionnaire, pk=pk)
    if not questionnaire.can_edit(request.user):
        return HttpResponseForbidden("You don't have access to this questionnaire.")

    selected_session, selected_code, _sessions = _selected_result_session(request, questionnaire)
    report = _build_report_data(questionnaire, selected_session)
    payload = build_word_report(report)

    response = HttpResponse(
        payload,
        content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    response["Content-Disposition"] = (
        f'attachment; filename="{_download_filename(questionnaire, selected_code, "docx")}"'
    )
    return response


@login_required
@require_POST
def reset_results(request, pk):
    questionnaire = get_object_or_404(Questionnaire, pk=pk)
    if not questionnaire.can_edit(request.user):
        return HttpResponseForbidden("You don't have access to this questionnaire.")

    selected_session, selected_code, sessions_qs = _selected_result_session(request, questionnaire)
    scope = (request.POST.get("scope") or "session").strip().lower()

    if scope == "all" or selected_code == "all":
        sessions = list(sessions_qs)
        redirect_code = "all"
    else:
        sessions = [selected_session] if selected_session else []
        redirect_code = selected_code

    with transaction.atomic():
        Response.objects.filter(question__questionnaire=questionnaire, session__in=sessions).delete()
        MatrixAnswer.objects.filter(question__questionnaire=questionnaire, session__in=sessions).delete()
        PointsAllocation.objects.filter(question__questionnaire=questionnaire, session__in=sessions).delete()
        Participant.objects.filter(session__in=sessions).delete()

    if redirect_code == "all":
        messages.success(request, "All saved results for this questionnaire have been reset.")
    else:
        messages.success(request, f"Saved results for session {redirect_code or 'latest'} have been reset.")

    url = reverse("polls:results", args=[questionnaire.pk])
    return redirect(f"{url}?session={redirect_code}" if redirect_code else url)


@login_required
@require_POST
def quick_add_question(request, pk):
    """Create a question with an optional initial text + type from the list page."""
    questionnaire = get_object_or_404(Questionnaire, pk=pk)
    if not questionnaire.can_edit(request.user):
        return HttpResponseForbidden("You don't have access to this questionnaire.")

    text = (request.POST.get("text") or "").strip() or "New question"
    qtype = request.POST.get("type") or "mcq"
    if qtype not in QUESTION_TYPE_REGISTRY:
        qtype = "mcq"

    meta = QUESTION_TYPE_REGISTRY[qtype]
    q = Question.objects.create(
        questionnaire=questionnaire,
        text=text,
        order=questionnaire.questions.count(),
        type=qtype,
        chart_type=meta.get("default_chart", "bar"),
    )
    _seed_default_choices(q)

    # Fetch returns JSON; regular form POST redirects back.
    if request.headers.get("X-Requested-With") == "fetch":
        return JsonResponse({
            "ok": True,
            "pk": q.pk,
            "text": q.text,
            "type": q.type,
            "type_label": meta["label"],
            "chart_type": q.chart_type,
            "edit_url": f"/polls/{questionnaire.pk}/q/{q.pk}/",
        })
    messages.success(request, f"Added “{text}”.")
    return redirect("polls:edit", pk=questionnaire.pk)


@login_required
@require_POST
def quick_delete_question(request, pk, qpk):
    questionnaire = get_object_or_404(Questionnaire, pk=pk)
    if not questionnaire.can_edit(request.user):
        return HttpResponseForbidden("You don't have access to this questionnaire.")
    Question.objects.filter(pk=qpk, questionnaire=questionnaire).delete()
    if request.headers.get("X-Requested-With") == "fetch":
        return JsonResponse({"ok": True})
    messages.info(request, "Question deleted.")
    return redirect("polls:edit", pk=questionnaire.pk)


@login_required
@require_POST
def delete(request, pk):
    """Permanently delete a questionnaire.

    Only the owner may delete — collaborators (even with edit role) cannot,
    matching the existing ownership-only semantics used by start_session.
    Always POST; we wire the dashboard's trash button as a tiny form.
    """
    q = get_object_or_404(Questionnaire, pk=pk)
    if q.owner_id != request.user.id:
        return HttpResponseForbidden("You can't delete this questionnaire.")

    title = q.title
    q.delete()
    messages.success(request, f"Deleted “{title}”.")

    # Where the user goes back to depends on where they came from.
    # The dashboard sends a `next` param; fall back to the questionnaire list.
    return _safe_next(request, "polls:list")


# ─────────────────────────────────────────────────────────────────
# Duplicate a questionnaire — deep copy of the deck, every question,
# each question's choices, and matrix rows. Session-time data
# (responses, matrix answers, points allocations, collaborator
# records) is intentionally NOT copied.
# ─────────────────────────────────────────────────────────────────

def _next_questionnaire_copy_title(owner, base_title):
    """
    Return a title that doesn't collide with the owner's existing
    questionnaires. "X" → "Copy of X", and on subsequent duplicates
    "Copy of X (2)", "(3)", etc. Stops at 99 and falls back to a
    plain "Copy of X" — the user can always rename later.
    """
    candidate = f"Copy of {base_title}"
    if not Questionnaire.objects.filter(owner=owner, title=candidate).exists():
        return candidate
    for n in range(2, 100):
        attempt = f"Copy of {base_title} ({n})"
        if not Questionnaire.objects.filter(owner=owner, title=attempt).exists():
            return attempt
    return candidate


@login_required
@require_POST
def duplicate(request, pk):
    """
    Deep-copy a questionnaire so the user can reuse its format.

    Copied:
      - Questionnaire row (all settings, template, mode, logo by reference)
      - Every Question (text, type, chart, typography, config JSON,
        skip_rules, title-slide fields, etc.)
      - Each question's Choice rows
      - Each question's MatrixRow rows

    NOT copied (intentional — those are session-time or trust-time data):
      - Response, MatrixAnswer, PointsAllocation
      - QuestionnaireCollaborator (the duplicate starts as a solo doc)
      - Any LiveSession history

    Permission: anyone who can edit the questionnaire (owner OR an
    edit-role collaborator) can duplicate it. The copy's owner becomes
    the duplicator — so a collaborator can fork the deck into their
    own private workspace.

    POST-only — never reachable as GET so a link prefetch can't make
    accidental copies.
    """
    original = get_object_or_404(Questionnaire, pk=pk)
    if not original.can_edit(request.user):
        messages.error(request, "You don't have permission to duplicate this.")
        return redirect("polls:list")

    with transaction.atomic():
        # 1) Clone the Questionnaire itself. Setting pk=None and calling
        #    save() is Django's idiomatic "copy this row with a new id".
        copy = Questionnaire.objects.get(pk=original.pk)
        copy.pk = None
        copy._state.adding = True
        copy.owner = request.user
        copy.title = _next_questionnaire_copy_title(request.user, original.title)
        # created_at / updated_at get reset by save() (auto_now_*).
        copy.save()

        # 2) Clone each Question. Build old→new map so child rows
        #    (choices, matrix rows) can be attached to the right new Q.
        question_map = {}
        for q in original.questions.all():
            old_pk = q.pk
            q.pk = None
            q._state.adding = True
            q.questionnaire = copy
            q.save()
            question_map[old_pk] = q

        # 3) Clone choices under their new questions.
        for old_q_pk, new_q in question_map.items():
            for c in Choice.objects.filter(question_id=old_q_pk):
                c.pk = None
                c._state.adding = True
                c.question = new_q
                c.save()

        # 4) Clone matrix rows (used by matrix-type questions).
        for old_q_pk, new_q in question_map.items():
            for row in MatrixRow.objects.filter(question_id=old_q_pk):
                row.pk = None
                row._state.adding = True
                row.question = new_q
                row.save()

    messages.success(
        request,
        f"Duplicated “{original.title}” → “{copy.title}”. "
        f"Edit it from your menti list.",
    )
    return _safe_next(request, "polls:list")