import json
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.db.models import Q
from django.shortcuts import render, redirect, get_object_or_404
from django.views.decorators.http import require_POST
from collections import Counter
from django.http import JsonResponse, HttpResponse, HttpResponseForbidden

from .exports import (
    QuestionResult,
    ReportData,
    build_word_report,
    build_excel_report,
)

from core.templates_registry import TEMPLATES, get_template
from core.chart_registry import CHARTS, charts_for
from presentations.models import LiveSession
from .forms import (
    QuestionnaireForm, QuestionForm, ChoiceFormSet, CollaboratorInviteForm,
)
from .models import Questionnaire, Question, Choice, QuestionnaireCollaborator, Response


# ─────────────────── helpers ───────────────────

def _editable_or_403(request, pk):
    """Fetch a questionnaire the current user owns OR collaborates on (edit)."""
    qs = Questionnaire.objects.filter(
        Q(owner=request.user) |
        Q(collaborators__user=request.user, collaborators__role__in=["edit"])
    ).distinct()
    questionnaire = get_object_or_404(qs, pk=pk)
    return questionnaire


def _accessible_qs(user):
    return Questionnaire.objects.filter(
        Q(owner=user) | Q(collaborators__user=user)
    ).distinct()


# ─────────────────── views ───────────────────

@login_required
def list_view(request):
    qs = _accessible_qs(request.user).order_by("-updated_at")
    return render(request, "polls/list.html", {"questionnaires": qs})


@login_required
def create(request):
    if request.method == "POST":
        form = QuestionnaireForm(request.POST, request.FILES)
        if form.is_valid():
            q = form.save(commit=False)
            q.owner = request.user
            q.save()
            messages.success(request, "Questionnaire created — add your questions!")
            return redirect("polls:edit", pk=q.pk)
    else:
        form = QuestionnaireForm()
    return render(request, "polls/create.html", {"form": form, "templates": TEMPLATES})


@login_required
def edit(request, pk):
    questionnaire = _editable_or_403(request, pk)

    if request.method == "POST":
        form = QuestionnaireForm(request.POST, request.FILES, instance=questionnaire)

        if form.is_valid():
            questionnaire = form.save()

            if request.FILES.get("logo"):
                messages.success(request, "Saved. Logo uploaded successfully.")
            else:
                messages.success(request, "Saved.")

            return redirect("polls:edit", pk=questionnaire.pk)

        messages.error(request, "Please correct the errors below.")
    else:
        form = QuestionnaireForm(instance=questionnaire)

    return render(request, "polls/edit.html", {
        "form": form,
        "questionnaire": questionnaire,
        "templates": TEMPLATES,
        "selected_template": get_template(questionnaire.template_id),
        "charts": CHARTS,
        "is_owner": questionnaire.owner_id == request.user.id,
        "collaborators": questionnaire.collaborators.select_related("user").all(),
        "invite_form": CollaboratorInviteForm(),
    })

@login_required
def question_create(request, pk):
    questionnaire = _editable_or_403(request, pk)
    next_order = questionnaire.questions.count()
    question = Question.objects.create(
        questionnaire=questionnaire, text="New question", order=next_order, type="mcq", chart_type="bar",
    )
    Choice.objects.create(question=question, text="Option A", order=0)
    Choice.objects.create(question=question, text="Option B", order=1)
    return redirect("polls:question_edit", pk=questionnaire.pk, qpk=question.pk)


@login_required
def question_edit(request, pk, qpk):
    questionnaire = _editable_or_403(request, pk)
    question = get_object_or_404(Question, pk=qpk, questionnaire=questionnaire)
    if request.method == "POST":
        form = QuestionForm(request.POST, request.FILES, instance=question)
        formset = ChoiceFormSet(request.POST, instance=question)
        if form.is_valid() and formset.is_valid():
            form.save()
            formset.save()
            messages.success(request, "Question saved.")
            return redirect("polls:edit", pk=questionnaire.pk)
    else:
        form = QuestionForm(instance=question)
        formset = ChoiceFormSet(instance=question)
    return render(request, "polls/question_edit.html", {
        "questionnaire": questionnaire,
        "question": question,
        "form": form,
        "formset": formset,
        "available_charts": charts_for(question.type),
        "all_charts": CHARTS,
    })


@login_required
@require_POST
def question_delete(request, pk, qpk):
    questionnaire = _editable_or_403(request, pk)
    Question.objects.filter(pk=qpk, questionnaire=questionnaire).delete()
    return redirect("polls:edit", pk=pk)


@login_required
@require_POST
def reorder_questions(request, pk):
    """AJAX endpoint — body: {order: [qpk, qpk, ...]} sets `order` field."""
    questionnaire = _editable_or_403(request, pk)
    try:
        data = json.loads(request.body)
        ids = data.get("order", [])
        for index, qpk in enumerate(ids):
            Question.objects.filter(pk=qpk, questionnaire=questionnaire).update(order=index)
        return JsonResponse({"ok": True})
    except Exception as e:
        return JsonResponse({"ok": False, "error": str(e)}, status=400)


@login_required
@require_POST
def set_template(request, pk):
    questionnaire = _editable_or_403(request, pk)
    template_id = request.POST.get("template_id")
    if any(t["id"] == template_id for t in TEMPLATES):
        questionnaire.template_id = template_id
        questionnaire.save()
    return JsonResponse({"ok": True, "template": get_template(questionnaire.template_id)})


@login_required
@require_POST
def start_session(request, pk):
    questionnaire = _editable_or_403(request, pk)
    session = LiveSession.objects.create(
        owner=request.user,
        kind="poll",
        questionnaire=questionnaire,
        mode=questionnaire.mode,
    )
    return redirect("presentations:present", code=session.code)

# ─────────────────── Results / Export ───────────────────

def _result_or_403(request, pk):
    """
    Owner or collaborator can view/export results.
    """
    qs = _accessible_qs(request.user)
    return get_object_or_404(qs, pk=pk)


def _safe_filename(value, fallback="poll-results"):
    value = str(value or fallback).strip()
    bad = ['/', '\\', ':', '*', '?', '"', '<', '>', '|']
    for ch in bad:
        value = value.replace(ch, "-")
    return value[:80] or fallback


def _get_latest_session(questionnaire):
    qs = LiveSession.objects.filter(
        kind="poll",
        questionnaire=questionnaire,
    )

    field_names = [f.name for f in LiveSession._meta.fields]

    if "created_at" in field_names:
        return qs.order_by("-created_at").first()

    return qs.order_by("-id").first()


def _get_all_sessions(questionnaire):
    qs = LiveSession.objects.filter(
        kind="poll",
        questionnaire=questionnaire,
    )

    field_names = [f.name for f in LiveSession._meta.fields]

    if "created_at" in field_names:
        return qs.order_by("-created_at")

    return qs.order_by("-id")


def _read_session_tally(session):
    """
    Reads tally/results from LiveSession regardless of which field name
    your current version is using.

    Expected shape:
    {
      "question_id": {
        "counts": {"choice_id": 2},
        "texts": ["open answer"]
      }
    }
    """
    if not session:
        return {}

    for attr in ("tally", "results", "answers", "state_data", "data"):
        if hasattr(session, attr):
            value = getattr(session, attr)

            if callable(value):
                try:
                    value = value()
                except TypeError:
                    continue

            if isinstance(value, dict):
                return value

    if hasattr(session, "get_tally"):
        try:
            value = session.get_tally()
            if isinstance(value, dict):
                return value
        except Exception:
            pass

    return {}


def _choice_text(choice):
    return (
        getattr(choice, "text", None)
        or getattr(choice, "label", None)
        or getattr(choice, "name", None)
        or str(choice)
    )


def _question_type_for_export(question):
    qtype = str(getattr(question, "type", "mcq") or "mcq").lower()

    if qtype in ("text", "open_text", "open-ended", "openended"):
        return "open"

    if qtype in ("wordcloud", "word_cloud"):
        return "word"

    if qtype in ("rating", "scale_1_10"):
        return "scale"

    if qtype in ("rank", "ranking"):
        return "ranking"

    return qtype


def _build_report_data(questionnaire):
    """
    Build export/report data from saved poll Response rows.

    This makes results permanent:
    - refresh safe
    - server restart safe
    - Redis/live-tally independent
    """
    latest_session = _get_latest_session(questionnaire)
    sessions = _get_all_sessions(questionnaire)

    response_qs = (
        Response.objects
        .filter(question__questionnaire=questionnaire)
        .select_related("question", "choice", "session")
    )

    if sessions.exists():
        response_qs = response_qs.filter(session__in=sessions)

    combined = {}

    for response in response_qs:
        qid = str(response.question_id)

        combined.setdefault(qid, {
            "counts": Counter(),
            "texts": [],
            "scale_values": [],
        })

        if response.choice_id:
            combined[qid]["counts"][str(response.choice_id)] += 1

        if response.text_value:
            combined[qid]["texts"].append(response.text_value)

        if response.numeric_value is not None:
            try:
                combined[qid]["scale_values"].append(float(response.numeric_value))
            except Exception:
                pass

        if response.question.type == "scale" and response.text_value and response.numeric_value is None:
            try:
                combined[qid]["scale_values"].append(float(response.text_value))
            except Exception:
                pass

    question_results = []

    questions = (
        questionnaire.questions
        .all()
        .prefetch_related("choices")
        .order_by("order", "id")
    )

    for question in questions:
        qid = str(question.id)
        qtype = _question_type_for_export(question)
        chart_type = str(getattr(question, "chart_type", "bar") or "bar").lower()

        data = combined.get(qid, {
            "counts": Counter(),
            "texts": [],
            "scale_values": [],
        })

        choices = list(question.choices.all().order_by("order", "id"))
        options = [_choice_text(choice) for choice in choices]
        counts = [
            int(data["counts"].get(str(choice.id), 0))
            for choice in choices
        ]

        words = []
        open_answers = []
        scale_values = []

        if qtype == "word":
            words = data["texts"]

        elif qtype == "open":
            open_answers = data["texts"]

        elif qtype == "scale":
            scale_values = data["scale_values"]

        question_results.append(QuestionResult(
            text=question.text,
            qtype=qtype,
            chart_type=chart_type,
            options=options,
            counts=counts,
            words=words,
            scale_values=scale_values,
            open_answers=open_answers,
        ))

    owner_name = (
        getattr(questionnaire.owner, "get_full_name", lambda: "")()
        or getattr(questionnaire.owner, "username", "")
        or "Unknown"
    )

    started_at = None
    ended_at = None

    if latest_session:
        started_at = (
            getattr(latest_session, "started_at", None)
            or getattr(latest_session, "created_at", None)
        )

        ended_at = (
            getattr(latest_session, "ended_at", None)
            or getattr(latest_session, "updated_at", None)
        )

    from django.utils import timezone

    if started_at is None:
        started_at = timezone.now()

    participant_count = (
        response_qs
        .exclude(participant_id="")
        .values("participant_id")
        .distinct()
        .count()
    )

    if participant_count == 0 and latest_session:
        participant_count = (
            getattr(latest_session, "participant_count", None)
            or getattr(latest_session, "participants_count", None)
            or 0
        )

        if callable(participant_count):
            try:
                participant_count = participant_count()
            except Exception:
                participant_count = 0

    return ReportData(
        title=questionnaire.title,
        description=getattr(questionnaire, "description", "") or "",
        owner_name=owner_name,
        session_code=getattr(latest_session, "code", "NO SESSION") if latest_session else "NO SESSION",
        mode=getattr(questionnaire, "mode", "") or "",
        started_at=started_at,
        ended_at=ended_at,
        participant_count=int(participant_count or 0),
        questions=question_results,
    )


@login_required
def questionnaire_results(request, pk):
    questionnaire = _result_or_403(request, pk)
    data = _build_report_data(questionnaire)

    return render(request, "polls/results.html", {
        "questionnaire": questionnaire,
        "report": data,
        "questions": data.questions,
        "total_responses": sum(q.total_responses for q in data.questions),
    })


@login_required
def download_results_excel(request, pk):
    questionnaire = _result_or_403(request, pk)
    data = _build_report_data(questionnaire)

    content = build_excel_report(data)
    filename = _safe_filename(questionnaire.title, "poll-results")

    response = HttpResponse(
        content,
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    response["Content-Disposition"] = f'attachment; filename="{filename}-results.xlsx"'
    return response


@login_required
def download_results_word(request, pk):
    questionnaire = _result_or_403(request, pk)
    data = _build_report_data(questionnaire)

    content = build_word_report(data)
    filename = _safe_filename(questionnaire.title, "poll-results")

    response = HttpResponse(
        content,
        content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    response["Content-Disposition"] = f'attachment; filename="{filename}-results.docx"'
    return response

# ─────────────────── Collaboration ───────────────────

@login_required
@require_POST
def invite_collaborator(request, pk):
    questionnaire = get_object_or_404(Questionnaire, pk=pk, owner=request.user)
    form = CollaboratorInviteForm(request.POST)
    if not form.is_valid():
        messages.error(request, "Invalid invite.")
        return redirect("polls:edit", pk=pk)
    user = form.find_user()
    if not user:
        messages.error(request, "No user found with that username or email. Make sure they've signed up first.")
        return redirect("polls:edit", pk=pk)
    if user == request.user:
        messages.error(request, "You're already the owner — no need to invite yourself.")
        return redirect("polls:edit", pk=pk)
    QuestionnaireCollaborator.objects.update_or_create(
        questionnaire=questionnaire, user=user,
        defaults={"role": form.cleaned_data["role"], "invited_by": request.user},
    )
    messages.success(request, f"{user.username} added as collaborator.")
    return redirect("polls:edit", pk=pk)


@login_required
@require_POST
def remove_collaborator(request, pk, cpk):
    questionnaire = get_object_or_404(Questionnaire, pk=pk, owner=request.user)
    QuestionnaireCollaborator.objects.filter(pk=cpk, questionnaire=questionnaire).delete()
    messages.success(request, "Collaborator removed.")
    return redirect("polls:edit", pk=pk)