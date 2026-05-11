import json
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.db.models import Q
from django.http import JsonResponse, HttpResponseForbidden
from django.shortcuts import render, redirect, get_object_or_404
from django.views.decorators.http import require_POST

from core.templates_registry import TEMPLATES, get_template
from core.chart_registry import CHARTS, charts_for
from presentations.models import LiveSession
from .forms import (
    QuestionnaireForm, QuestionForm, ChoiceFormSet, CollaboratorInviteForm,
)
from .models import Questionnaire, Question, Choice, QuestionnaireCollaborator


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
            form.save()
            messages.success(request, "Saved.")
            return redirect("polls:edit", pk=pk)
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