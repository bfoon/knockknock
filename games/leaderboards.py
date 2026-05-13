"""
Leaderboard helpers for the games app.

`Participant.score` is denormalized (incremented by the WebSocket consumer
as answers come in), so we never need to re-aggregate GameAnswer rows
just to render a top-3 widget — a single ORDER BY is enough.

We DO walk GameAnswer for the per-question stats inside the exports,
because those need correct/incorrect counts and timing data.
"""
from collections import defaultdict

from django.db.models import Avg, Count, Q
from presentations.models import LiveSession, Participant

from .avatars import avatar_by_id
from .models import GameAnswer, GameChoice, GameQuestion, Quiz


# ─────────────────────────────────────────────────────────────────
# Top-3 widget
# ─────────────────────────────────────────────────────────────────

def _decorate(participant):
    """Attach the avatar emoji + colour for template rendering."""
    av = avatar_by_id(participant.avatar_id)
    return {
        "nickname": participant.nickname,
        "avatar_id": participant.avatar_id,
        "emoji": av["emoji"],
        "color": av["color"],
        "score": participant.score,
        "session_code": participant.session.code,
        "session_id": participant.session_id,
    }


def top_three_for_quiz(quiz):
    """Top 3 scorers across ALL sessions of a quiz, decorated for templates.

    Used on the dashboard "Recent games" row and on games/edit. If two
    participants have the same score, the earlier joiner ranks higher
    (matches the default ordering on Participant).
    """
    qs = (
        Participant.objects
        .filter(session__quiz=quiz, session__kind="game")
        .select_related("session")
        .order_by("-score", "joined_at")[:3]
    )
    return [_decorate(p) for p in qs]


def top_three_for_session(session):
    """Top 3 scorers for ONE session — used in the export header."""
    qs = (
        Participant.objects
        .filter(session=session)
        .select_related("session")
        .order_by("-score", "joined_at")[:3]
    )
    return [_decorate(p) for p in qs]


# ─────────────────────────────────────────────────────────────────
# Full leaderboard + per-question stats (used by the exports)
# ─────────────────────────────────────────────────────────────────

def full_leaderboard(session):
    """Every participant for a session, ranked. List of dicts."""
    rows = []
    for rank, p in enumerate(
        Participant.objects.filter(session=session).order_by("-score", "joined_at"),
        start=1,
    ):
        av = avatar_by_id(p.avatar_id)
        rows.append({
            "rank": rank,
            "nickname": p.nickname,
            "avatar_id": p.avatar_id,
            "emoji": av["emoji"],
            "score": p.score,
            "room_id": p.room_id or "",
        })
    return rows


def per_question_stats(session):
    """For each question in the quiz, return aggregate stats for this session.

    Returns: list of dicts shaped like:
      {
        "question": GameQuestion,
        "answer_count": int,
        "correct_count": int,
        "correct_pct": float,        # 0-100
        "avg_time_ms": int,
        "distribution": [(choice_label, count, is_correct), ...],
      }
    For puzzle questions the distribution is a single
    "Solved correctly" / "Did not solve" pair, since there are no
    discrete choices to tally.
    """
    if not session.quiz_id:
        return []

    questions = (
        GameQuestion.objects
        .filter(quiz_id=session.quiz_id)
        .prefetch_related("choices")
        .order_by("order", "id")
    )

    # Pre-bucket answers per question to avoid N+1 queries.
    answers_by_question = defaultdict(list)
    for ans in GameAnswer.objects.filter(session=session).select_related("choice"):
        answers_by_question[ans.question_id].append(ans)

    stats = []
    for q in questions:
        answers = answers_by_question.get(q.id, [])
        n = len(answers)
        n_correct = sum(1 for a in answers if a.is_correct)
        avg_time = (sum(a.time_taken_ms for a in answers) // n) if n else 0

        if q.question_type == "puzzle":
            distribution = [
                ("Solved correctly", n_correct, True),
                ("Did not solve",    n - n_correct, False),
            ]
        else:
            counts = {c.id: 0 for c in q.choices.all()}
            for a in answers:
                if a.choice_id in counts:
                    counts[a.choice_id] += 1
            distribution = []
            for c in q.choices.all().order_by("order", "id"):
                label = (c.text or f"Choice {c.id}").strip()
                # Picture choices may have no text → fall back to a stub label.
                if not c.text and c.image:
                    label = f"Picture {c.order + 1}"
                distribution.append((label, counts.get(c.id, 0), c.is_correct))

        stats.append({
            "question": q,
            "answer_count": n,
            "correct_count": n_correct,
            "correct_pct": (100.0 * n_correct / n) if n else 0.0,
            "avg_time_ms": avg_time,
            "distribution": distribution,
        })
    return stats
