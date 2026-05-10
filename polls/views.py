from django.contrib.auth.decorators import login_required
from django.contrib import messages
from django.http import JsonResponse
from django.shortcuts import render, redirect, get_object_or_404
from django.views.decorators.http import require_POST

from core.templates_registry import TEMPLATES, get_template
from core.chart_registry import CHARTS, charts_for
from presentations.models import LiveSession
from .forms import QuestionnaireForm, QuestionForm, ChoiceFormSet
from .models import Questionnaire, Question, Choice


@login_required
def list_view(request):
    qs = Questionnaire.objects.filter(owner=request.user)
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
    questionnaire = get_object_or_404(Questionnaire, pk=pk, owner=request.user)
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
    })


@login_required
def question_create(request, pk):
    questionnaire = get_object_or_404(Questionnaire, pk=pk, owner=request.user)
    next_order = questionnaire.questions.count()
    question = Question.objects.create(
        questionnaire=questionnaire, text="New question", order=next_order, type="mcq", chart_type="bar",
    )
    Choice.objects.create(question=question, text="Option A", order=0)
    Choice.objects.create(question=question, text="Option B", order=1)
    return redirect("polls:question_edit", pk=questionnaire.pk, qpk=question.pk)


@login_required
def question_edit(request, pk, qpk):
    questionnaire = get_object_or_404(Questionnaire, pk=pk, owner=request.user)
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
    questionnaire = get_object_or_404(Questionnaire, pk=pk, owner=request.user)
    Question.objects.filter(pk=qpk, questionnaire=questionnaire).delete()
    return redirect("polls:edit", pk=pk)


@login_required
@require_POST
def set_template(request, pk):
    questionnaire = get_object_or_404(Questionnaire, pk=pk, owner=request.user)
    template_id = request.POST.get("template_id")
    if any(t["id"] == template_id for t in TEMPLATES):
        questionnaire.template_id = template_id
        questionnaire.save()
    return JsonResponse({"ok": True, "template": get_template(questionnaire.template_id)})


@login_required
@require_POST
def start_session(request, pk):
    """Start a live presentation session for this questionnaire."""
    questionnaire = get_object_or_404(Questionnaire, pk=pk, owner=request.user)
    session = LiveSession.objects.create(
        owner=request.user,
        kind="poll",
        questionnaire=questionnaire,
        mode=questionnaire.mode,
    )
    return redirect("presentations:present", code=session.code)
