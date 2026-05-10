from django.contrib.auth.decorators import login_required
from django.contrib import messages
from django.shortcuts import render, redirect, get_object_or_404
from django.views.decorators.http import require_POST

from core.templates_registry import TEMPLATES, get_template
from presentations.models import LiveSession
from .forms import QuizForm, GameQuestionForm, GameChoiceFormSet
from .models import Quiz, GameQuestion, GameChoice


@login_required
def list_view(request):
    qs = Quiz.objects.filter(owner=request.user)
    return render(request, "games/list.html", {"quizzes": qs})


@login_required
def create(request):
    if request.method == "POST":
        form = QuizForm(request.POST, request.FILES)
        if form.is_valid():
            quiz = form.save(commit=False)
            quiz.owner = request.user
            quiz.save()
            messages.success(request, "Quiz created — start adding questions!")
            return redirect("games:edit", pk=quiz.pk)
    else:
        form = QuizForm()
    return render(request, "games/create.html", {"form": form, "templates": TEMPLATES})


@login_required
def edit(request, pk):
    quiz = get_object_or_404(Quiz, pk=pk, owner=request.user)
    if request.method == "POST":
        form = QuizForm(request.POST, request.FILES, instance=quiz)
        if form.is_valid():
            form.save()
            messages.success(request, "Saved.")
            return redirect("games:edit", pk=pk)
    else:
        form = QuizForm(instance=quiz)
    return render(request, "games/edit.html", {
        "form": form,
        "quiz": quiz,
        "templates": TEMPLATES,
        "selected_template": get_template(quiz.template_id),
    })


@login_required
def question_create(request, pk):
    quiz = get_object_or_404(Quiz, pk=pk, owner=request.user)
    q = GameQuestion.objects.create(
        quiz=quiz, text="New question", order=quiz.questions.count(),
    )
    for i, t in enumerate(["Red", "Blue", "Yellow", "Green"]):
        GameChoice.objects.create(question=q, text=t, order=i, is_correct=(i == 0))
    return redirect("games:question_edit", pk=quiz.pk, qpk=q.pk)


@login_required
def question_edit(request, pk, qpk):
    quiz = get_object_or_404(Quiz, pk=pk, owner=request.user)
    question = get_object_or_404(GameQuestion, pk=qpk, quiz=quiz)
    if request.method == "POST":
        form = GameQuestionForm(request.POST, request.FILES, instance=question)
        formset = GameChoiceFormSet(request.POST, instance=question)
        if form.is_valid() and formset.is_valid():
            form.save()
            formset.save()
            messages.success(request, "Question saved.")
            return redirect("games:edit", pk=quiz.pk)
    else:
        form = GameQuestionForm(instance=question)
        formset = GameChoiceFormSet(instance=question)
    return render(request, "games/question_edit.html", {
        "quiz": quiz, "question": question, "form": form, "formset": formset,
    })


@login_required
@require_POST
def question_delete(request, pk, qpk):
    quiz = get_object_or_404(Quiz, pk=pk, owner=request.user)
    GameQuestion.objects.filter(pk=qpk, quiz=quiz).delete()
    return redirect("games:edit", pk=pk)


@login_required
@require_POST
def start_session(request, pk):
    quiz = get_object_or_404(Quiz, pk=pk, owner=request.user)
    session = LiveSession.objects.create(
        owner=request.user,
        kind="game",
        quiz=quiz,
        mode=quiz.mode,
    )
    return redirect("presentations:present", code=session.code)
