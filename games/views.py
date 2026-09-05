import json

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.db import transaction
from django.db.models import Count, F, Prefetch
from django.http import HttpResponse, HttpResponseBadRequest, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils.encoding import iri_to_uri
from django.utils.http import url_has_allowed_host_and_scheme
from django.utils.text import slugify
from django.views.decorators.http import require_POST

from core.templates_registry import TEMPLATES, get_template
from presentations.models import LiveSession

from .avatars import AVATARS, avatars_grouped
from .exports import build_excel, build_word
from .forms import GameChoiceFormSet, GameQuestionForm, GameRoomFormSet, QuizForm
from .leaderboards import room_standings, top_three_for_quiz
from .models import GameChoice, GameQuestion, GameRoom, Quiz

#: Answer rows offered when a question is first created.
_STARTER_CHOICES = {
    "puzzle": ["Piece 1", "Piece 2", "Piece 3", "Piece 4"],
    "picture_choice": ["Picture A", "Picture B", "Picture C", "Picture D"],
    # picture_prompt is MCQ-shaped: text answers, one correct. The defaults
    # nod at the canonical "which ocean is this?" example so the question type
    # explains itself the first time someone opens it.
    "picture_prompt": ["Pacific Ocean", "Atlantic Ocean", "Indian Ocean", "Arctic Ocean"],
    "mcq": ["Red", "Blue", "Yellow", "Green"],
}

_STARTER_TEXT = {
    "mcq": "New question",
    "picture_choice": "Select the correct picture",
    "picture_prompt": "What is shown in this image?",
    "puzzle": "Arrange the puzzle pieces in the correct order",
}


def _safe_next(request, fallback_url_name):
    """Resolve a `next` parameter without opening a redirect hole.

    The old check was `nxt.startswith("/")`, which happily accepts
    `//evil.example.com/` — browsers read that as a protocol-relative URL and
    leave the site. `url_has_allowed_host_and_scheme` is the check Django's
    own login view uses.
    """
    nxt = request.POST.get("next") or ""
    if nxt and url_has_allowed_host_and_scheme(
        url=nxt, allowed_hosts={request.get_host()}, require_https=request.is_secure()
    ):
        return redirect(iri_to_uri(nxt))
    return redirect(fallback_url_name)


@login_required
def list_view(request):
    qs = (
        Quiz.objects
        .filter(owner=request.user)
        .annotate(num_questions=Count("questions", distinct=True))
    )
    return render(request, "games/list.html", {"quizzes": qs})


@login_required
def create(request):
    if request.method == "POST":
        form = QuizForm(request.POST, request.FILES)
        if form.is_valid():
            quiz = form.save(commit=False)
            quiz.owner = request.user
            quiz.save()
            messages.success(request, "Game created. Add your first question.")
            return redirect("games:edit", pk=quiz.pk)
        messages.error(request, "Check the highlighted fields and try again.")
    else:
        form = QuizForm()

    return render(request, "games/create.html", {
        "form": form,
        "templates": TEMPLATES,
        # The picker used to be told `selected_id="neon"`, which matches no
        # template in the registry — so nothing appeared selected and, because
        # the partial was included without `input_name`, the choice was never
        # posted either. Every new game silently got the default template.
        "selected_template_id": form["template_id"].value() or "neon_gaming",
    })


@login_required
def edit(request, pk):
    quiz = get_object_or_404(Quiz, pk=pk, owner=request.user)

    if request.method == "POST":
        form = QuizForm(request.POST, request.FILES, instance=quiz)
        room_formset = GameRoomFormSet(request.POST, instance=quiz, prefix="rooms")

        quiz_ok = form.is_valid()
        rooms_ok = room_formset.is_valid()

        if quiz_ok and rooms_ok:
            with transaction.atomic():
                form.save()
                _save_rooms(quiz, room_formset)
            messages.success(request, "Saved.")
            return redirect("games:edit", pk=pk)

        # Surface formset errors so the author can see why it failed instead
        # of silently re-rendering an empty rooms list.
        if not rooms_ok:
            problems = []
            for i, f in enumerate(room_formset.forms, start=1):
                if f.errors:
                    problems.append(
                        f"Room {i}: " + "; ".join(
                            f"{k}: {', '.join(v)}" for k, v in f.errors.items()
                        )
                    )
            problems.extend(room_formset.non_form_errors())
            if problems:
                messages.error(request, "Rooms not saved — " + " | ".join(problems))
        if not quiz_ok:
            messages.error(request, "Check the highlighted fields and try again.")
    else:
        form = QuizForm(instance=quiz)
        room_formset = GameRoomFormSet(instance=quiz, prefix="rooms")

    questions = quiz.questions.prefetch_related("choices").all()

    return render(request, "games/edit.html", {
        "form": form,
        "quiz": quiz,
        "questions": questions,
        "question_count": len(questions),
        "templates": TEMPLATES,
        "selected_template": get_template(quiz.template_id),
        "room_formset": room_formset,
        "avatars": AVATARS,
        "avatar_groups": avatars_grouped(),
        "top_three": top_three_for_quiz(quiz),
    })


def _save_rooms(quiz, room_formset):
    """Persist the rooms editor, filling in derived slugs and orders.

    Rooms are saved one at a time rather than through `formset.save()` because
    the slug is derived, has to stay unique inside the quiz, and may collide
    with a sibling that is being renamed in the same request.
    """
    position = 0
    for f in room_formset.forms:
        data = getattr(f, "cleaned_data", None)
        if not data:
            continue                      # untouched extra row
        if data.get("DELETE"):
            if f.instance.pk:
                f.instance.delete()
            continue

        obj = f.save(commit=False)
        obj.quiz = quiz
        obj.name = (data.get("name") or "").strip()
        obj.avatar_id = data.get("avatar_id") or "dragon"
        # Renumber from the rendered sequence. The old code trusted the
        # hidden `order` input, which the "add room" button set to the
        # formset index — so deleting a room mid-list left duplicate orders
        # and the doors came back in an arbitrary sequence.
        obj.order = position
        position += 1

        slug = (data.get("slug") or "").strip() or slugify(obj.name) or "room"
        base, n = slug, 2
        while GameRoom.objects.filter(quiz=quiz, slug=slug).exclude(pk=obj.pk).exists():
            slug = f"{base}-{n}"
            n += 1
        obj.slug = slug

        obj.save()


@login_required
@require_POST
def delete(request, pk):
    """Permanently delete a whole quiz (and its questions / sessions via cascade).

    POST-only — never reachable as a GET so accidental link-prefetch can't
    nuke a quiz. The dashboard's red trash bin posts here with a `next` param
    so the user lands back where they started.
    """
    quiz = get_object_or_404(Quiz, pk=pk, owner=request.user)
    title = quiz.title
    quiz.delete()
    messages.success(request, f"Deleted “{title}”.")
    return _safe_next(request, "games:list")


# ─────────────────────────────────────────────────────────────────
# Questions
# ─────────────────────────────────────────────────────────────────

@login_required
def question_create(request, pk):
    quiz = get_object_or_404(Quiz, pk=pk, owner=request.user)

    qtype = request.GET.get("type", "mcq")
    allowed = {value for value, _label in GameQuestion.QUESTION_TYPE_CHOICES}
    if qtype not in allowed:
        qtype = "mcq"

    with transaction.atomic():
        question = GameQuestion.objects.create(
            quiz=quiz,
            question_type=qtype,
            text=_STARTER_TEXT.get(qtype, "New question"),
            order=quiz.questions.count(),
        )
        labels = _STARTER_CHOICES.get(qtype, _STARTER_CHOICES["mcq"])
        GameChoice.objects.bulk_create([
            GameChoice(
                question=question,
                text=label,
                order=i,
                correct_position=(i + 1) if qtype == "puzzle" else 0,
                is_correct=True if qtype == "puzzle" else (i == 0),
            )
            for i, label in enumerate(labels)
        ])

    return redirect("games:question_edit", pk=quiz.pk, qpk=question.pk)


@login_required
def question_edit(request, pk, qpk):
    quiz = get_object_or_404(Quiz, pk=pk, owner=request.user)
    question = get_object_or_404(GameQuestion, pk=qpk, quiz=quiz)

    if request.method == "POST":
        form = GameQuestionForm(request.POST, request.FILES, instance=question)
        formset = GameChoiceFormSet(request.POST, request.FILES, instance=question)

        # The answer rules depend on the question type, and the type can be
        # changed by this very request. Hand the formset the submitted type so
        # it doesn't validate a brand-new puzzle against multiple-choice rules.
        submitted_type = request.POST.get("question_type")
        if submitted_type in {v for v, _ in GameQuestion.QUESTION_TYPE_CHOICES}:
            formset.question_type = submitted_type

        if form.is_valid() and formset.is_valid():
            with transaction.atomic():
                question = form.save()
                choices = formset.save(commit=False)
                for obj in choices:
                    obj.question = question
                    obj.save()
                for obj in formset.deleted_objects:
                    obj.delete()
                _renumber_choices(question)

            messages.success(request, "Question saved.")
            if "save_and_new" in request.POST:
                url = reverse("games:question_create", args=[quiz.pk])
                return redirect(f"{url}?type={question.question_type}")
            return redirect("games:edit", pk=quiz.pk)

        messages.error(request, "Question not saved — see the notes below.")
    else:
        form = GameQuestionForm(instance=question)
        formset = GameChoiceFormSet(instance=question)

    siblings = list(quiz.questions.values_list("pk", flat=True))
    index = siblings.index(question.pk) + 1 if question.pk in siblings else 1

    return render(request, "games/question_edit.html", {
        "quiz": quiz,
        "question": question,
        "form": form,
        "formset": formset,
        "question_index": index,
        "question_total": len(siblings),
    })


def _renumber_choices(question):
    """Keep `order` a clean 0..n-1 run after adds and deletes."""
    updates = []
    for i, choice in enumerate(question.choices.all()):
        if choice.order != i:
            choice.order = i
            updates.append(choice)
    if updates:
        GameChoice.objects.bulk_update(updates, ["order"])


@login_required
@require_POST
def question_delete(request, pk, qpk):
    quiz = get_object_or_404(Quiz, pk=pk, owner=request.user)
    GameQuestion.objects.filter(pk=qpk, quiz=quiz).delete()
    _renumber_questions(quiz)
    messages.success(request, "Question deleted.")
    return redirect("games:edit", pk=pk)


@login_required
@require_POST
def question_duplicate(request, pk, qpk):
    """Copy a question and its answers, inserting the copy directly after it."""
    quiz = get_object_or_404(Quiz, pk=pk, owner=request.user)
    original = get_object_or_404(GameQuestion, pk=qpk, quiz=quiz)
    source_choices = list(original.choices.all())
    source_order = original.order or 0

    with transaction.atomic():
        # Make a hole immediately after the original so the copy lands next
        # to it rather than at the bottom of a long list.
        quiz.questions.filter(order__gt=source_order).update(order=F("order") + 1)

        copy = original
        copy.pk = None
        copy._state.adding = True
        copy.order = source_order + 1
        copy.save()

        GameChoice.objects.bulk_create([
            GameChoice(
                question=copy,
                text=c.text,
                image=c.image,
                is_correct=c.is_correct,
                correct_position=c.correct_position,
                order=c.order,
            )
            for c in source_choices
        ])
        _renumber_questions(quiz)

    messages.success(request, "Question duplicated.")
    return redirect("games:question_edit", pk=quiz.pk, qpk=copy.pk)


def _renumber_questions(quiz):
    updates = []
    for i, q in enumerate(quiz.questions.all()):
        if q.order != i:
            q.order = i
            updates.append(q)
    if updates:
        GameQuestion.objects.bulk_update(updates, ["order"])


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
    except (AttributeError, TypeError, ValueError):
        return HttpResponseBadRequest("Invalid payload.")

    by_id = {q.pk: q for q in quiz.questions.all()}
    if set(ids) != set(by_id):
        # Usually means the quiz was edited in another tab.
        return JsonResponse(
            {"ok": False, "error": "This list is out of date. Reload the page."},
            status=409,
        )

    updates = []
    for new_order, qpk in enumerate(ids):
        q = by_id[qpk]
        if q.order != new_order:
            q.order = new_order
            updates.append(q)
    if updates:
        GameQuestion.objects.bulk_update(updates, ["order"])
    return JsonResponse({"ok": True, "updated": len(updates)})


# ─────────────────────────────────────────────────────────────────
# Sessions
# ─────────────────────────────────────────────────────────────────

@login_required
@require_POST
def start_session(request, pk):
    quiz = get_object_or_404(Quiz, pk=pk, owner=request.user)

    # The Start button is disabled in the editor when there are no questions,
    # but a disabled button is a suggestion, not a rule.
    if not quiz.questions.exists():
        messages.error(request, "Add at least one question before starting.")
        return redirect("games:edit", pk=quiz.pk)

    if quiz.use_rooms and not quiz.rooms.exists():
        messages.error(request, "Rooms are on but none are set up. Add a room, or switch rooms off.")
        return redirect("games:edit", pk=quiz.pk)

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

    Lists every LiveSession that ever ran this quiz with participant count,
    state, and Excel/Word export buttons per session.
    """
    quiz = get_object_or_404(Quiz, pk=pk, owner=request.user)
    sessions = list(
        LiveSession.objects
        .filter(quiz=quiz, kind="game")
        .annotate(num_participants=Count("participants"))
        .order_by("-created_at")
    )

    latest_rooms = room_standings(sessions[0]) if sessions else []

    return render(request, "games/results.html", {
        "quiz": quiz,
        "sessions": sessions,
        "session_count": len(sessions),
        "player_total": sum(s.num_participants for s in sessions),
        "top_three": top_three_for_quiz(quiz),
        "latest_rooms": latest_rooms,
    })


def _export_filename(session, ext):
    """Filesystem-safe filename like 'gameresults_5-brain-rewire_842913.xlsx'."""
    title = slugify(session.quiz.title) if session.quiz else "results"
    return f"gameresults_{title or 'results'}_{session.code}.{ext}"


def _download(buf, content_type, filename):
    response = HttpResponse(buf.getvalue(), content_type=content_type)
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    response["Content-Length"] = str(buf.getbuffer().nbytes)
    return response


@login_required
def export_session_excel(request, pk, session_id):
    """Download .xlsx for a specific session of this quiz."""
    quiz = get_object_or_404(Quiz, pk=pk, owner=request.user)
    session = get_object_or_404(LiveSession, pk=session_id, quiz=quiz, kind="game")
    return _download(
        build_excel(session),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        _export_filename(session, "xlsx"),
    )


@login_required
def export_session_word(request, pk, session_id):
    """Download .docx for a specific session of this quiz."""
    quiz = get_object_or_404(Quiz, pk=pk, owner=request.user)
    session = get_object_or_404(LiveSession, pk=session_id, quiz=quiz, kind="game")
    return _download(
        build_word(session),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        _export_filename(session, "docx"),
    )


# ─────────────────────────────────────────────────────────────────
# Duplicate a quiz — deep copy of the quiz, its questions, each
# question's choices, and the rooms. Game answers / sessions are
# session-time data and are NOT copied.
# ─────────────────────────────────────────────────────────────────

def _next_copy_title(owner, base_title):
    """Return a title that doesn't collide with the owner's existing quizzes.

    "X" → "Copy of X", and on subsequent duplicates "Copy of X (2)", "(3)",
    etc. Stops at 99 to avoid silly numbers and falls back to a plain
    "Copy of X" — the user can always rename later.
    """
    candidate = f"Copy of {base_title}"
    if not Quiz.objects.filter(owner=owner, title=candidate).exists():
        return candidate
    for n in range(2, 100):
        attempt = f"Copy of {base_title} ({n})"
        if not Quiz.objects.filter(owner=owner, title=attempt).exists():
            return attempt
    return candidate


@login_required
@require_POST
def duplicate(request, pk):
    """Deep-copy a quiz the user owns so they can reuse the format.

    Copied: the Quiz row itself (all settings), every GameQuestion with its
    GameChoice rows, and every GameRoom. Not copied: GameAnswer rows or
    LiveSessions — those are session results, not template content, so a fresh
    duplicate starts clean.

    POST-only so an accidental link prefetch can't create copies.
    """
    original = get_object_or_404(
        Quiz.objects.prefetch_related(
            Prefetch("questions", queryset=GameQuestion.objects.prefetch_related("choices")),
            "rooms",
        ),
        pk=pk,
        owner=request.user,
    )
    source_questions = list(original.questions.all())
    source_rooms = list(original.rooms.all())
    original_title = original.title

    with transaction.atomic():
        copy = Quiz.objects.get(pk=original.pk)
        copy.pk = None
        # Django needs this alongside `pk = None` to be certain the next
        # save() is an INSERT. Without it, a model with a non-auto primary
        # key silently UPDATEs the row it was copied from.
        copy._state.adding = True
        copy.title = _next_copy_title(request.user, original_title)
        # created_at / updated_at have auto_now_add / auto_now and are reset by
        # save(). The logo FileField is shared by reference — both quizzes
        # point at the same upload, which is fine since neither edits it.
        copy.save()

        for q in source_questions:
            source_choices = list(q.choices.all())
            q.pk = None
            q._state.adding = True
            q.quiz = copy
            q.save()
            GameChoice.objects.bulk_create([
                GameChoice(
                    question=q,
                    text=c.text,
                    image=c.image,
                    is_correct=c.is_correct,
                    correct_position=c.correct_position,
                    order=c.order,
                )
                for c in source_choices
            ])

        for room in source_rooms:
            room.pk = None
            room._state.adding = True
            room.quiz = copy
            room.save()

    messages.success(request, f"Duplicated “{original_title}” as “{copy.title}”.")
    return _safe_next(request, "games:list")
