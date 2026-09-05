"""
Leaderboard helpers for the games app.

`Participant.score` is denormalized (incremented by the WebSocket consumer as
answers come in), so we never need to re-aggregate GameAnswer rows just to
render a top-3 widget — a single ORDER BY is enough.

We DO walk GameAnswer for the per-question stats inside the exports, because
those need correct/incorrect counts and timing data.

Two fixes worth knowing about:

* `per_question_stats` used to call `q.choices.all().order_by(...)` inside the
  question loop. Adding `.order_by()` to a prefetched related manager throws
  the prefetch cache away and issues a fresh query, so the prefetch_related
  above it did nothing and the export ran one query per question. GameChoice
  already orders by (order, id) in Meta, so the explicit ordering was
  redundant as well as expensive.
* Ranking is now tie-aware. Two players on 4200 points both placed 3rd; the
  old code silently made one of them 4th, which is the kind of thing a
  classroom notices immediately.
"""
from collections import defaultdict

from presentations.models import Participant

from .avatars import avatar_by_id
from .models import GameAnswer, GameQuestion


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
    """Every participant for a session, ranked. List of dicts.

    Ranks are competition-style: 1, 2, 2, 4.
    """
    rows = []
    previous_score = None
    previous_rank = 0

    participants = Participant.objects.filter(session=session).order_by("-score", "joined_at")
    for position, p in enumerate(participants, start=1):
        if p.score == previous_score:
            rank = previous_rank
        else:
            rank = position
            previous_rank = rank
            previous_score = p.score

        av = avatar_by_id(p.avatar_id)
        rows.append({
            "rank": rank,
            "nickname": p.nickname,
            "avatar_id": p.avatar_id,
            "emoji": av["emoji"],
            "color": av["color"],
            "score": p.score,
            "room_id": p.room_id or "",
        })
    return rows


def room_standings(session):
    """Average score per room, best first.

    `Quiz.use_rooms` promises members are "scored by room average" but nothing
    computed that average, so a room-based game had no room result. Returns []
    when the quiz doesn't use rooms or nobody picked a room.
    """
    quiz = session.quiz
    if not quiz or not quiz.use_rooms:
        return []

    room_names = {r.slug: r.name for r in quiz.rooms.all()}

    buckets = defaultdict(list)
    for p in Participant.objects.filter(session=session).only("room_id", "score"):
        if p.room_id:
            buckets[p.room_id].append(p.score)

    rows = [
        {
            "room_id": room_id,
            "name": room_names.get(room_id, room_id),
            "members": len(scores),
            "total": sum(scores),
            "average": round(sum(scores) / len(scores), 1) if scores else 0.0,
        }
        for room_id, scores in buckets.items()
    ]
    rows.sort(key=lambda r: (-r["average"], r["name"]))
    for i, row in enumerate(rows, start=1):
        row["rank"] = i
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
        "late_count": int,
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
    for ans in GameAnswer.objects.filter(session=session).only(
        "question_id", "choice_id", "is_correct", "time_taken_ms", "was_late"
    ):
        answers_by_question[ans.question_id].append(ans)

    stats = []
    for q in questions:
        answers = answers_by_question.get(q.id, [])
        n = len(answers)
        n_correct = sum(1 for a in answers if a.is_correct)
        n_late = sum(1 for a in answers if a.was_late)
        avg_time = (sum(a.time_taken_ms for a in answers) // n) if n else 0

        if q.is_puzzle:
            distribution = [
                ("Solved correctly", n_correct, True),
                ("Did not solve",    n - n_correct, False),
            ]
        else:
            counts = defaultdict(int)
            for a in answers:
                if a.choice_id is not None:
                    counts[a.choice_id] += 1
            # `q.choices.all()` uses the prefetched cache and the model's own
            # (order, id) ordering. Do not add .order_by() here.
            distribution = [
                (c.display_label, counts.get(c.id, 0), c.is_correct)
                for c in q.choices.all()
            ]

        stats.append({
            "question": q,
            "answer_count": n,
            "correct_count": n_correct,
            "correct_pct": (100.0 * n_correct / n) if n else 0.0,
            "avg_time_ms": avg_time,
            "late_count": n_late,
            "distribution": distribution,
        })
    return stats
