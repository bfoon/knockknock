"""
Helpers for the game WebSocket consumer.

(Renamed from `consumer_special_question_helpers.py` — import path changes to
`from .consumer_helpers import ...`.)

Your consumers.py was not uploaded, so this file provides the pieces it needs:
serialising a question for the client, checking a submitted answer, tallying
responses for the live chart, and persisting the answer.

THREE THINGS CHANGED HERE THAT AFFECT BEHAVIOUR
-----------------------------------------------
1. `serialize_game_question` no longer sends `correct_position`. The old
   version shipped every puzzle piece's correct slot to every player's
   browser — anyone with devtools open could read the solution off the
   socket frame before the timer started.
2. `build_game_tally` ran one COUNT query per choice per tally. It is now a
   single grouped aggregate, which matters because the tally is recomputed on
   every incoming answer.
3. `create_game_answer` records `was_late` and refuses to double-count a
   participant who submits twice for the same question.
"""
from __future__ import annotations

import random

from django.db.models import Count

from .models import GameAnswer
from .scoring import Verdict, evaluate_submission


def serialize_game_question(question, *, reveal_answers: bool = False):
    """Question payload for the play/present clients.

    Set `reveal_answers=True` only for the presenter's own socket, or after
    the question has closed. It is False for participants — the payload must
    never contain enough information to derive the correct answer.
    """
    choices = list(question.choices.all())  # Meta.ordering is already (order, id)

    display_order = list(range(len(choices)))
    if question.question_type == "puzzle":
        # Pieces must arrive scrambled, otherwise the natural ordering IS
        # the answer. Seeded per question so every player sees the same
        # scramble and the presenter's screen matches theirs.
        rng = random.Random(question.id)
        rng.shuffle(display_order)

    payload_choices = []
    for slot, idx in enumerate(display_order):
        c = choices[idx]
        entry = {
            "id": c.id,
            "text": c.text,
            "image_url": c.image.url if c.image else "",
            "order": slot,
        }
        if reveal_answers:
            entry["is_correct"] = c.is_correct
            entry["correct_position"] = c.correct_position
        payload_choices.append(entry)

    return {
        "id": question.id,
        "type": question.question_type,
        "question_type": question.question_type,
        "text": question.text,
        "image_url": question.image.url if question.image else "",
        "time_limit": question.time_limit,
        "points": question.points,
        "font_family": question.font_family,
        "font_size": question.font_size,
        "font_bold": question.font_bold,
        "text_italic": question.text_italic,
        "text_underline": question.text_underline,
        "text_align": question.text_align,
        "text_color": question.text_color,
        "background_color": question.background_color,
        "background_gradient_to": question.background_gradient_to,
        "answer_shape": question.answer_shape,
        "choices": payload_choices,
    }


def check_game_answer(question, payload):
    """Grade a raw submission payload. Returns choice / puzzle_order / is_correct."""
    if question.question_type == "puzzle":
        raw = payload.get("puzzle_order") or []
        submitted = []
        for x in raw:
            try:
                submitted.append(int(x))
            except (TypeError, ValueError):
                # A malformed id makes the whole submission unscoreable —
                # better to mark it wrong than to crash the consumer.
                return {"choice": None, "puzzle_order": [], "is_correct": False}

        correct = list(
            question.choices.filter(correct_position__gt=0)
            .order_by("correct_position", "id")
            .values_list("id", flat=True)
        )
        return {
            "choice": None,
            "puzzle_order": submitted,
            "is_correct": bool(correct) and submitted == correct,
        }

    choice = question.choices.filter(id=payload.get("choice_id")).first()
    return {"choice": choice, "puzzle_order": [], "is_correct": bool(choice and choice.is_correct)}


def build_game_tally(session, question):
    """Live response distribution for the presenter's chart."""
    if question.question_type == "puzzle":
        winner = (
            GameAnswer.objects
            .filter(session=session, question=question, is_correct=True)
            .order_by("created_at", "id")
            .first()
        )
        return {
            "counts": {},
            "texts": [],
            "winner": {
                "nickname": winner.nickname,
                "avatar_id": winner.avatar_id,
                "points": winner.points_awarded,
            } if winner else None,
        }

    # One grouped query instead of one COUNT per choice.
    tallied = dict(
        GameAnswer.objects
        .filter(session=session, question=question, choice__isnull=False)
        .values_list("choice_id")
        .annotate(n=Count("id"))
    )
    counts = {str(c.id): tallied.get(c.id, 0) for c in question.choices.all()}
    return {"counts": counts, "texts": []}


def create_game_answer(
    session,
    question,
    participant,
    payload,
    elapsed_ms: int = 0,
    extra_seconds: int = 0,
    correct_rank: int | None = None,
):
    """Grade, score and persist one submission.

    Returns `(answer, verdict)`. When the verdict is rejected — a late answer
    on a quiz that does not allow them — `answer` is None and nothing is
    written, so the participant's score is untouched.

    Scoring is no longer the caller's job: passing `points_awarded` in from
    the consumer meant the answer was graded twice, once for points and again
    on the way to the database, and the two could disagree.
    """
    checked = check_game_answer(question, payload)

    verdict = evaluate_submission(
        quiz=session.quiz,
        question=question,
        is_correct=checked["is_correct"],
        elapsed_ms=elapsed_ms,
        extra_seconds=extra_seconds,
        correct_rank=correct_rank,
    )
    if verdict.rejected:
        return None, verdict

    answer, created = GameAnswer.objects.get_or_create(
        session=session,
        question=question,
        participant_id=getattr(participant, "uid", "") or "",
        defaults={
            "nickname": getattr(participant, "nickname", "") or "",
            "avatar_id": getattr(participant, "avatar_id", "") or "dragon",
            "choice": checked["choice"],
            "puzzle_order": checked["puzzle_order"],
            "is_correct": checked["is_correct"],
            "points_awarded": verdict.points,
            "time_taken_ms": max(0, int(elapsed_ms or 0)),
            "was_late": verdict.was_late,
            "room_id": getattr(participant, "room_id", "") or "",
        },
    )

    if not created:
        # Duplicate frame — the first answer stands. Report it as rejected so
        # the caller does not add the points to Participant.score a second time.
        return answer, Verdict(
            accepted=False, points=0, was_late=answer.was_late, reason="already_answered"
        )

    return answer, verdict

