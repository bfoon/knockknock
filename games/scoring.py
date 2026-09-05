"""
Deadline enforcement and point calculation for live game answers.

WHY THIS FILE EXISTS
--------------------
`Quiz.allow_late_answers` and `Quiz.late_answer_points_pct` were modelled,
form-validated and exposed in the editor UI, but nothing in the codebase ever
read them. `GameAnswer.was_late` was likewise never written. A presenter could
switch late answers off and players would still score after the timer hit zero.

Everything here is pure Python over plain values — no ORM access, no Channels
imports — so the consumer can call it and a unit test can too.

STATUS: consumers.py implements this logic inline and correctly, including
the server-clock deadline check. This module reproduces that behaviour
exactly — same floor, same grace window, same base-limit measurement — so
adopting it is a refactor and not a rules change. Its value is that the rules
become testable and stop being duplicated between the consumer and anything
else that needs to score (a replay tool, a fixture generator, a migration).

WIRING IT UP (in your consumer, when a question is pushed)
----------------------------------------------------------
    state["question_started_at"] = time.monotonic()
    state["extra_seconds"] = 0          # bumped by the +5s / +10s buttons

and when an answer frame arrives:

    verdict = evaluate_submission(
        quiz=session.quiz,
        question=question,
        is_correct=checked["is_correct"],
        elapsed_ms=int((time.monotonic() - state["question_started_at"]) * 1000),
        extra_seconds=state["extra_seconds"],
        correct_rank=state["correct_so_far"],   # 0 for the first correct player
    )
    if verdict.rejected:
        return await self.send_json({"type": "answer_rejected", "reason": verdict.reason})
"""
from __future__ import annotations

from dataclasses import dataclass

#: A correct answer at the very last moment still earns this share of the
#: points under speed scoring, so a player on a slow connection is punished
#: for their network rather than their knowledge.
#:
#: 0.25 matches what consumers.py already awards. An earlier draft of this
#: module used 0.5, which would have quietly rebalanced every existing game
#: the moment the consumer switched over to it — the kind of change that is
#: invisible in a diff and obvious to a room full of players.
SPEED_FLOOR = 0.25

#: Grace window for clock skew and network latency. An answer arriving within
#: this many milliseconds of the deadline counts as on time. Matches the
#: 0.75s fudge in the consumer's deadline check.
LATENCY_GRACE_MS = 750

#: A small edge for the first correct answer, off by default. The live
#: consumer awards no such bonus, so turning this on changes scoring for
#: every game — decide that deliberately rather than inheriting it.
FIRST_CORRECT_BONUS = 0.0


@dataclass(frozen=True)
class Verdict:
    """Outcome of one submission."""

    accepted: bool
    points: int
    was_late: bool
    reason: str = ""

    @property
    def rejected(self) -> bool:
        return not self.accepted


def deadline_ms(question, extra_seconds: int = 0) -> int:
    """Milliseconds a player has, including any presenter time extensions."""
    limit = max(0, int(getattr(question, "time_limit", 0) or 0))
    extra = max(0, int(extra_seconds or 0))
    return (limit + extra) * 1000


def is_late(question, elapsed_ms: int, extra_seconds: int = 0) -> bool:
    limit = deadline_ms(question, extra_seconds)
    if limit <= 0:
        return False
    return int(elapsed_ms or 0) > limit + LATENCY_GRACE_MS


def speed_points(base_points: int, elapsed_ms: int, limit_ms: int) -> int:
    """Points scaled by how much of the clock was left.

    Answer instantly and you keep all of `base_points`; answer as the timer
    expires and you keep `SPEED_FLOOR` of them. The scale is linear in
    between, which is what makes a live game feel like a race.
    """
    if limit_ms <= 0:
        return int(base_points)
    used = min(1.0, max(0.0, int(elapsed_ms or 0) / limit_ms))
    # Linear decay from full points down to the floor, which is reached at
    # (1 - SPEED_FLOOR) of the clock. This is the curve consumers.py uses:
    #     max(SPEED_FLOOR, 1.0 - elapsed / limit)
    factor = max(SPEED_FLOOR, 1.0 - used)
    return int(round(base_points * factor))


def evaluate_submission(
    quiz,
    question,
    is_correct: bool,
    elapsed_ms: int,
    extra_seconds: int = 0,
    correct_rank: int | None = None,
) -> Verdict:
    """Decide whether an answer counts, and what it is worth.

    `correct_rank` is how many players already answered this question
    correctly (0 for the first). It is only consulted under speed scoring, to
    break ties in favour of whoever got there first.
    """
    late = is_late(question, elapsed_ms, extra_seconds)
    allow_late = bool(getattr(quiz, "allow_late_answers", False))

    if late and not allow_late:
        return Verdict(accepted=False, points=0, was_late=True, reason="time_up")

    if not is_correct:
        return Verdict(accepted=True, points=0, was_late=late)

    base = max(0, int(getattr(question, "points", 0) or 0))
    scoring = getattr(quiz, "scoring", "speed")

    if scoring == "accuracy":
        # Every correct answer is worth the same — the clock only decides
        # whether you were allowed to answer at all.
        points = base
    else:
        # Note the consumer measures elapsed against the BASE time_limit,
        # not the extended one, so a presenter granting +10s does not also
        # deflate everyone's speed score. Keep that behaviour.
        base_limit_ms = max(1, int(getattr(question, "time_limit", 1) or 1) * 1000)
        points = speed_points(base, elapsed_ms, base_limit_ms)
        if correct_rank == 0 and FIRST_CORRECT_BONUS:
            points = int(round(points * (1.0 + FIRST_CORRECT_BONUS)))

    if late:
        multiplier = getattr(quiz, "late_points_multiplier", None)
        if multiplier is None:
            pct = max(0, min(100, int(getattr(quiz, "late_answer_points_pct", 0) or 0)))
            multiplier = pct / 100.0
        points = int(round(points * multiplier))

    return Verdict(accepted=True, points=max(0, points), was_late=late)
