"""KnockKnock Quest RPG models.

This app adds an immersive team-based quiz adventure to KnockKnock.
Hosts create a quest, participants join in teams, discuss answers together,
and progress through animated worlds toward a treasure.
"""

import random

from django.conf import settings
from django.db import models
from django.utils import timezone


_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def gen_code(length=6):
    return "".join(random.choice(_CODE_ALPHABET) for _ in range(length))


class QuestSession(models.Model):
    WORLD_JUNGLE = "jungle"
    WORLD_SEA = "sea"
    WORLD_SPACE = "space"
    WORLD_CAVE = "cave"
    WORLD_FOREST = "forest"

    WORLD_CHOICES = [
        (WORLD_JUNGLE, "Jungle Treasure"),
        (WORLD_SEA, "Deep Sea Quest"),
        (WORLD_SPACE, "Space Mission"),
        (WORLD_CAVE, "Crystal Cave"),
        (WORLD_FOREST, "Mystic Forest"),
    ]

    STATUS_DRAFT = "draft"
    STATUS_LIVE = "live"
    STATUS_ENDED = "ended"
    STATUS_CHOICES = [
        (STATUS_DRAFT, "Draft"),
        (STATUS_LIVE, "Live"),
        (STATUS_ENDED, "Ended"),
    ]

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="quest_rpg_sessions",
        null=True,
        blank=True,
    )
    code = models.CharField(max_length=12, unique=True, db_index=True)
    title = models.CharField(max_length=160, default="Untitled Quest")
    world = models.CharField(max_length=20, choices=WORLD_CHOICES, default=WORLD_JUNGLE)
    team_size = models.PositiveIntegerField(default=4, help_text="Recommended team size. Use 0 for unlimited/N.")
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=STATUS_DRAFT)
    current_question = models.PositiveIntegerField(default=0)
    allow_rejoin = models.BooleanField(default=True)
    show_correct_after_answer = models.BooleanField(default=False)
    started_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def save(self, *args, **kwargs):
        if not self.code:
            code = gen_code()
            while QuestSession.objects.filter(code=code).exists():
                code = gen_code()
            self.code = code
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.title} ({self.code})"

    @property
    def question_count(self):
        return self.questions.count()

    def as_dict(self, include_answers=True):
        return {
            "id": self.id,
            "code": self.code,
            "title": self.title,
            "world": self.world,
            "team_size": self.team_size,
            "status": self.status,
            "current_question": self.current_question,
            "show_correct_after_answer": self.show_correct_after_answer,
            "started_at": self.started_at.isoformat() if self.started_at else "",
            "questions": [q.as_dict(include_answer=include_answers) for q in self.questions.all()],
            "teams": [t.as_dict() for t in self.teams.all()],
        }


class QuestQuestion(models.Model):
    session = models.ForeignKey(QuestSession, on_delete=models.CASCADE, related_name="questions")
    position = models.PositiveIntegerField(default=0)
    prompt = models.TextField()
    option_a = models.CharField(max_length=500, blank=True)
    option_b = models.CharField(max_length=500, blank=True)
    option_c = models.CharField(max_length=500, blank=True)
    option_d = models.CharField(max_length=500, blank=True)
    correct_option = models.CharField(max_length=1, default="A")
    points = models.PositiveIntegerField(default=100)
    treasure_hint = models.CharField(max_length=240, blank=True)
    danger_text = models.CharField(max_length=240, blank=True)
    explanation = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["position", "id"]

    def __str__(self):
        return f"Q{self.position + 1}: {self.prompt[:40]}"

    def options(self):
        return [
            {"key": "A", "text": self.option_a},
            {"key": "B", "text": self.option_b},
            {"key": "C", "text": self.option_c},
            {"key": "D", "text": self.option_d},
        ]

    def as_dict(self, include_answer=True):
        data = {
            "id": self.id,
            "position": self.position,
            "prompt": self.prompt,
            "options": self.options(),
            "points": self.points,
            "treasure_hint": self.treasure_hint,
            "danger_text": self.danger_text,
            "explanation": self.explanation if include_answer else "",
        }
        if include_answer:
            data["correct_option"] = self.correct_option
        return data


class QuestTeam(models.Model):
    AVATAR_CHOICES = [
        ("explorer", "Explorer"),
        ("warrior", "Warrior"),
        ("wizard", "Wizard"),
        ("robot", "Robot"),
        ("astronaut", "Astronaut"),
        ("pirate", "Pirate"),
        ("mermaid", "Mermaid"),
        ("dragon", "Dragon"),
        ("lion", "Lion"),
        ("eagle", "Eagle"),
    ]

    session = models.ForeignKey(QuestSession, on_delete=models.CASCADE, related_name="teams")
    name = models.CharField(max_length=80)
    avatar = models.CharField(max_length=30, choices=AVATAR_CHOICES, default="explorer")
    points = models.PositiveIntegerField(default=0)
    correct_count = models.PositiveIntegerField(default=0)
    wrong_count = models.PositiveIntegerField(default=0)
    progress = models.PositiveIntegerField(default=0)
    completed_at = models.DateTimeField(null=True, blank=True)
    last_seen_at = models.DateTimeField(default=timezone.now)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-points", "-correct_count", "created_at"]
        unique_together = [("session", "name")]

    def __str__(self):
        return f"{self.name} · {self.session.code}"

    def as_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "avatar": self.avatar,
            "points": self.points,
            "correct_count": self.correct_count,
            "wrong_count": self.wrong_count,
            "progress": self.progress,
            "completed_at": self.completed_at.isoformat() if self.completed_at else "",
        }


class QuestResponse(models.Model):
    team = models.ForeignKey(QuestTeam, on_delete=models.CASCADE, related_name="responses")
    question = models.ForeignKey(QuestQuestion, on_delete=models.CASCADE, related_name="responses")
    selected_option = models.CharField(max_length=1)
    is_correct = models.BooleanField(default=False)
    points_awarded = models.PositiveIntegerField(default=0)
    wrong_choices = models.JSONField(default=list, blank=True)
    answered_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["answered_at"]
        unique_together = [("team", "question")]

    def as_dict(self):
        return {
            "team_id": self.team_id,
            "question_id": self.question_id,
            "selected_option": self.selected_option,
            "is_correct": self.is_correct,
            "points_awarded": self.points_awarded,
            "wrong_choices": self.wrong_choices or [],
            "answered_at": self.answered_at.isoformat(),
        }
