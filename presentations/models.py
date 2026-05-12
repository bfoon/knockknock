import secrets
import string
from django.conf import settings
from django.db import models


def _gen_code():
    """6-digit numeric code — easy to type on a phone."""
    return "".join(secrets.choice(string.digits) for _ in range(6))


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