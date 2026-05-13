import json

from django.contrib.auth.decorators import login_required
from django.contrib import messages
from django.db.models import Count
from django.http import JsonResponse, HttpResponse, HttpResponseBadRequest
from django.shortcuts import render, redirect, get_object_or_404
from django.utils.text import slugify
from django.views.decorators.http import require_POST

from core.templates_registry import TEMPLATES, get_template
from presentations.models import LiveSession
from .avatars import AVATARS, avatars_grouped
from .exports import build_excel, build_word
from .forms import QuizForm, GameQuestionForm, GameChoiceFormSet, GameRoomFormSet
from .leaderboards import top_three_for_quiz
from .models import Quiz, GameQuestion, GameChoice, GameRoom


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
        room_formset = GameRoomFormSet(request.POST, instance=quiz, prefix="rooms")

        quiz_ok = form.is_valid()
        rooms_ok = room_formset.is_valid()

        if quiz_ok and rooms_ok:
            form.save()

            # Save rooms one by one so we can fill in derived slugs and
            # avoid colliding ones. We rely on each form's cleaned_data
            # because the slug may have been computed in clean().
            for f in room_formset.forms:
                if not f.cleaned_data:
                    # Empty extra row → skip.
                    continue
                if f.cleaned_data.get("DELETE"):
                    if f.instance.pk:
                        f.instance.delete()
                    continue

                obj = f.save(commit=False)
                obj.quiz = quiz

                # Pull the derived slug (clean() may have computed it).
                slug = (f.cleaned_data.get("slug") or "").strip()
                if not slug:
                    slug = slugify(f.cleaned_data.get("name") or "") or "room"

                # If the slug collides with a sibling, suffix it.
                base, i = slug, 2
                while GameRoom.objects.filter(quiz=quiz, slug=slug).exclude(pk=obj.pk).exists():
                    slug = f"{base}-{i}"
                    i += 1
                obj.slug = slug

                # Fill remaining defaults from cleaned_data.
                obj.avatar_id = (f.cleaned_data.get("avatar_id") or "dragon").strip() or "dragon"
                obj.order = f.cleaned_data.get("order") or 0
                obj.name = (f.cleaned_data.get("name") or "").strip()

                obj.save()

            messages.success(request, "Saved.")
            return redirect("games:edit", pk=pk)
        else:
            # Surface formset errors so the user can see why it failed
            # instead of silently re-rendering an empty rooms list.
            if not rooms_ok:
                err_summary = []
                for i, f in enumerate(room_formset.forms):
                    if f.errors:
                        err_summary.append(f"Room #{i + 1}: " + "; ".join(
                            f"{k}: {', '.join(v)}" for k, v in f.errors.items()
                        ))
                if room_formset.non_form_errors():
                    err_summary.append("; ".join(room_formset.non_form_errors()))
                if err_summary:
                    messages.error(request, "Couldn't save rooms — " + " | ".join(err_summary))
    else:
        form = QuizForm(instance=quiz)
        room_formset = GameRoomFormSet(instance=quiz, prefix="rooms")

    return render(request, "games/edit.html", {
        "form": form,
        "quiz": quiz,
        "templates": TEMPLATES,
        "selected_template": get_template(quiz.template_id),
        "room_formset": room_formset,
        "avatars": AVATARS,
        "avatar_groups": avatars_grouped(),
    })


@login_required
def question_create(request, pk):
    quiz = get_object_or_404(Quiz, pk=pk, owner=request.user)

    qtype = request.GET.get("type", "mcq")
    allowed = {value for value, _label in GameQuestion.QUESTION_TYPE_CHOICES}
    if qtype not in allowed:
        qtype = "mcq"

    default_text = {
        "mcq": "New question",
        "picture_choice": "Select the correct picture",
        "puzzle": "Arrange the puzzle pieces in the correct order",
    }.get(qtype, "New question")

    q = GameQuestion.objects.create(
        quiz=quiz,
        question_type=qtype,
        text=default_text,
        order=quiz.questions.count(),
    )

    if qtype == "puzzle":
        for i, text in enumerate(["Piece 1", "Piece 2", "Piece 3", "Piece 4"], start=1):
            GameChoice.objects.create(question=q, text=text, order=i - 1, correct_position=i, is_correct=True)
    elif qtype == "picture_choice":
        for i, text in enumerate(["Picture A", "Picture B", "Picture C", "Picture D"]):
            GameChoice.objects.create(question=q, text=text, order=i, correct_position=0, is_correct=(i == 0))
    else:
        for i, text in enumerate(["Red", "Blue", "Yellow", "Green"]):
            GameChoice.objects.create(question=q, text=text, order=i, correct_position=0, is_correct=(i == 0))

    return redirect("games:question_edit", pk=quiz.pk, qpk=q.pk)


@login_required
def question_edit(request, pk, qpk):
    quiz = get_object_or_404(Quiz, pk=pk, owner=request.user)
    question = get_object_or_404(GameQuestion, pk=qpk, quiz=quiz)

    if request.method == "POST":
        form = GameQuestionForm(request.POST, request.FILES, instance=question)
        formset = GameChoiceFormSet(request.POST, request.FILES, instance=question)

        if form.is_valid() and formset.is_valid():
            question = form.save()
            choices = formset.save(commit=False)

            for obj in choices:
                obj.question = question
                obj.save()

            for obj in formset.deleted_objects:
                obj.delete()

            messages.success(request, "Question saved.")
            return redirect("games:edit", pk=quiz.pk)
    else:
        form = GameQuestionForm(instance=question)
        formset = GameChoiceFormSet(instance=question)

    return render(request, "games/question_edit.html", {
        "quiz": quiz,
        "question": question,
        "form": form,
        "formset": formset,
    })


@login_required
@require_POST
def question_delete(request, pk, qpk):
    quiz = get_object_or_404(Quiz, pk=pk, owner=request.user)
    GameQuestion.objects.filter(pk=qpk, quiz=quiz).delete()
    return redirect("games:edit", pk=pk)


@login_required
@require_POST
def question_reorder(request, pk):
    """Persist a new order for questions in a quiz.

    Body: JSON `{"order": [qpk1, qpk2, ...]}` with ALL of the quiz's question
    primary keys in the desired sequence. Returns 200 on success.
    """
    quiz = get_object_or_404(Quiz, pk=pk, owner=request.user)
    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
        ids = [int(x) for x in payload.get("order", [])]
    except (ValueError, json.JSONDecodeError):
        return HttpResponseBadRequest("Invalid payload.")

    existing = {q.pk for q in quiz.questions.all()}
    if set(ids) != existing:
        return HttpResponseBadRequest("ID set mismatch.")

    # Bulk-update orders.
    by_id = {q.pk: q for q in quiz.questions.all()}
    for new_order, qpk in enumerate(ids):
        q = by_id[qpk]
        if q.order != new_order:
            q.order = new_order
            q.save(update_fields=["order"])
    return JsonResponse({"ok": True})


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

# ─────────────────────────────────────────────────────────────────
# Results hub + Excel/Word exports for past game sessions.
# ─────────────────────────────────────────────────────────────────

@login_required
def results(request, pk):
    """Session picker for a quiz.

    Lists every LiveSession that ever ran this quiz with participant
    count, state, and Excel/Word export buttons per session.
    """
    quiz = get_object_or_404(Quiz, pk=pk, owner=request.user)
    sessions = (
        LiveSession.objects
        .filter(quiz=quiz, kind="game")
        .annotate(num_participants=Count("participants"))
        .order_by("-created_at")
    )
    return render(request, "games/results.html", {
        "quiz": quiz,
        "sessions": sessions,
        "top_three": top_three_for_quiz(quiz),
    })


def _export_filename(session, ext):
    """Filesystem-safe filename like 'gameresults_5-brain-rewire_842913.xlsx'."""
    title = slugify(session.quiz.title) if session.quiz else "results"
    return f"gameresults_{title}_{session.code}.{ext}"


@login_required
def export_session_excel(request, pk, session_id):
    """Download .xlsx for a specific session of this quiz."""
    quiz = get_object_or_404(Quiz, pk=pk, owner=request.user)
    session = get_object_or_404(LiveSession, pk=session_id, quiz=quiz, kind="game")

    buf = build_excel(session)
    response = HttpResponse(
        buf.getvalue(),
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    response["Content-Disposition"] = f'attachment; filename="{_export_filename(session, "xlsx")}"'
    return response


@login_required
def export_session_word(request, pk, session_id):
    """Download .docx for a specific session of this quiz."""
    quiz = get_object_or_404(Quiz, pk=pk, owner=request.user)
    session = get_object_or_404(LiveSession, pk=session_id, quiz=quiz, kind="game")

    buf = build_word(session)
    response = HttpResponse(
        buf.getvalue(),
        content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    response["Content-Disposition"] = f'attachment; filename="{_export_filename(session, "docx")}"'
    return response