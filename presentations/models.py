import secrets
import string
from django.conf import settings
from django.db import models


def _gen_code():
    """6-digit numeric code — easy to type on a phone."""
    return "".join(secrets.choice(string.digits) for _ in range(6))


def unused_code():
    """A 6-digit code no session is using right now."""
    while True:
        code = _gen_code()
        if not LiveSession.objects.filter(code=code).exists():
            return code


class LiveSession(models.Model):
    """A live, in-progress presentation. Owns both polls and games."""

    KIND_CHOICES = [("poll", "Poll"), ("game", "Game")]
    STATE_CHOICES = [
        ("lobby",   "Lobby"),
        ("running", "Running"),
        ("ended",   "Ended"),
    ]
    MODE_CHOICES = [
        ("orchestra", "Orchestra"),
        ("open",      "Open"),
    ]

    code = models.CharField(max_length=6, unique=True, default=_gen_code, db_index=True)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sessions")
    kind = models.CharField(max_length=10, choices=KIND_CHOICES)
    state = models.CharField(max_length=10, choices=STATE_CHOICES, default="lobby")
    mode = models.CharField(max_length=20, choices=MODE_CHOICES, default="orchestra")
    current_question_index = models.IntegerField(default=-1)  # -1 = lobby

    questionnaire = models.ForeignKey("polls.Questionnaire", null=True, blank=True, on_delete=models.SET_NULL)
    quiz = models.ForeignKey("games.Quiz", null=True, blank=True, on_delete=models.SET_NULL)

    # ── Synchronized server-driven question timer ──
    # Every client (presenter and every participant) computes "seconds left"
    # from `question_started_at + base time_limit + time_extension_seconds`.
    # Set on every advance/goto/back. Cleared (None) in lobby/ended.
    question_started_at = models.DateTimeField(null=True, blank=True)
    time_extension_seconds = models.PositiveIntegerField(
        default=0,
        help_text="Extra seconds added to the CURRENT question by the presenter (+5 / +10 buttons).",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"{self.code} ({self.kind})"

    @property
    def title(self):
        return self.questionnaire.title if self.questionnaire else (self.quiz.title if self.quiz else "Untitled")

    @property
    def template_id(self):
        return self.questionnaire.template_id if self.questionnaire else (self.quiz.template_id if self.quiz else "space_hud")

    def nav_key(self):
        """
        Identifies exactly what's on screen right now: state, question and
        when that question started. Changes on every navigation, even a
        goto to the same index.

        The presenter sends the nav_key it was looking at with every
        Next/Back/goto, and the server only acts if it still matches. A
        second tap (or a resend after a reconnect) carries the old key and
        is ignored, so a double tap can never skip a question.
        """
        started = int(self.question_started_at.timestamp() * 1000) if self.question_started_at else 0
        return f"{self.state}:{self.current_question_index}:{started}"

    def questions(self):
        if self.kind == "poll" and self.questionnaire:
            return list(self.questionnaire.questions.all())
        if self.kind == "game" and self.quiz:
            return list(self.quiz.questions.all())
        return []


class Participant(models.Model):
    session = models.ForeignKey(LiveSession, on_delete=models.CASCADE, related_name="participants")
    participant_uid = models.CharField(max_length=64, db_index=True)
    nickname = models.CharField(max_length=40)
    avatar_id = models.CharField(max_length=30, default="dragon")
    room_id = models.CharField(max_length=40, blank=True)
    score = models.IntegerField(default=0)
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("session", "participant_uid")
        ordering = ["-score", "joined_at"]


class SessionRound(models.Model):
    """
    An earlier round of a join code that was restarted fresh.

    "Play again" on a session keeps the code players know (same link, same
    QR, same 6 digits) and starts from zero. To do that, the round that
    held the code is moved aside: it gets a new internal code so the
    played code is free again, and this row remembers which code the room
    actually played with. That round's answers, players and scores stay
    attached to it, so its results and exports are unchanged.

    Kept as its own table (not a column on LiveSession) so a server that
    hasn't run the migration yet still runs live sessions normally; only
    "Play again" needs it.
    """
    session = models.OneToOneField(LiveSession, on_delete=models.CASCADE, related_name="as_round")
    played_code = models.CharField(max_length=6, db_index=True)
    archived_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["archived_at"]

    def __str__(self):
        return f"{self.played_code} round archived {self.archived_at:%Y-%m-%d %H:%M}"

