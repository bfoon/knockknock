"""
Patch these helper functions into your game WebSocket consumer.
Your consumers.py was not uploaded, so this file provides the exact code needed for that missing part.
"""

from .models import GameAnswer


def serialize_game_question(question):
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
        "choices": [
            {
                "id": c.id,
                "text": c.text,
                "image_url": c.image.url if c.image else "",
                "correct_position": c.correct_position,
                "order": c.order,
            }
            for c in question.choices.all().order_by("order", "id")
        ],
    }


def check_game_answer(question, payload):
    if question.question_type == "puzzle":
        submitted_order = payload.get("puzzle_order") or []
        submitted_order = [int(x) for x in submitted_order if str(x).isdigit()]
        correct_order = list(
            question.choices.filter(correct_position__gt=0)
            .order_by("correct_position", "id")
            .values_list("id", flat=True)
        )
        return {"choice": None, "puzzle_order": submitted_order, "is_correct": submitted_order == correct_order}

    choice_id = payload.get("choice_id")
    choice = question.choices.filter(id=choice_id).first()
    return {"choice": choice, "puzzle_order": [], "is_correct": bool(choice and choice.is_correct)}


def build_game_tally(session, question):
    if question.question_type == "puzzle":
        winner = GameAnswer.objects.filter(session=session, question=question, is_correct=True).order_by("created_at").first()
        return {
            "counts": {},
            "texts": [],
            "winner": {
                "nickname": winner.nickname,
                "avatar_id": winner.avatar_id,
                "points": winner.points_awarded,
            } if winner else None,
        }

    counts = {}
    for choice in question.choices.all().order_by("order", "id"):
        counts[str(choice.id)] = GameAnswer.objects.filter(session=session, question=question, choice=choice).count()
    return {"counts": counts, "texts": []}


def create_game_answer(session, question, participant, payload, points_awarded=0, time_taken_ms=0):
    checked = check_game_answer(question, payload)
    return GameAnswer.objects.create(
        session=session,
        question=question,
        participant_id=getattr(participant, "uid", ""),
        nickname=getattr(participant, "nickname", ""),
        avatar_id=getattr(participant, "avatar_id", "dragon") or "dragon",
        choice=checked["choice"],
        puzzle_order=checked["puzzle_order"],
        is_correct=checked["is_correct"],
        points_awarded=points_awarded,
        time_taken_ms=time_taken_ms,
        room_id=getattr(participant, "room_id", "") or "",
    )
