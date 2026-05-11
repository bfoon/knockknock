from django.conf import settings
from django.db import models


FONT_CHOICES = [
    ("inter",      "Inter (sans, modern)"),
    ("manrope",    "Manrope (sans, clean)"),
    ("poppins",    "Poppins (sans, friendly)"),
    ("clash",      "Clash Display (display, bold)"),
    ("lora",       "Lora (serif, editorial)"),
    ("cormorant",  "Cormorant Garamond (serif, elegant)"),
    ("jetbrains",  "JetBrains Mono (mono, code)"),
    ("orbitron",   "Orbitron (sci-fi)"),
    ("vt323",      "VT323 (retro pixel)"),
    ("press",      "Press Start 2P (arcade)"),
]


class Questionnaire(models.Model):
    """A deck of questions — Mentimeter-style."""

    MODE_CHOICES = [
        ("orchestra", "Orchestra (presenter-controlled)"),
        ("open", "Open (self-paced)"),
    ]

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="questionnaires")
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    template_id = models.CharField(max_length=40, default="midnight")
    logo = models.ImageField(upload_to="questionnaire_logos/", blank=True, null=True)
    mode = models.CharField(max_length=20, choices=MODE_CHOICES, default="orchestra")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return self.title

    def can_edit(self, user) -> bool:
        if not user.is_authenticated:
            return False
        if self.owner_id == user.id:
            return True
        return self.collaborators.filter(user=user, role__in=["edit", "owner"]).exists()


class QuestionnaireCollaborator(models.Model):
    ROLE_CHOICES = [
        ("view", "Can view"),
        ("edit", "Can edit"),
    ]
    questionnaire = models.ForeignKey(Questionnaire, on_delete=models.CASCADE, related_name="collaborators")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="collaborations")
    role = models.CharField(max_length=10, choices=ROLE_CHOICES, default="edit")
    invited_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
                                   related_name="sent_invites")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("questionnaire", "user")
        ordering = ["created_at"]

    def __str__(self):
        return f"{self.user} on {self.questionnaire} ({self.role})"


class Question(models.Model):
    TYPE_CHOICES = [
        ("mcq",     "Multiple Choice"),
        ("word",    "Word Cloud"),
        ("scale",   "Scale (1-10)"),
        ("open",    "Open Text"),
        ("ranking", "Ranking"),
    ]

    questionnaire = models.ForeignKey(Questionnaire, on_delete=models.CASCADE, related_name="questions")
    text = models.CharField(max_length=500)
    type = models.CharField(max_length=20, choices=TYPE_CHOICES, default="mcq")
    chart_type = models.CharField(max_length=30, default="bar")
    order = models.PositiveIntegerField(default=0)
    image = models.ImageField(upload_to="question_images/", blank=True, null=True)

    # NEW: per-question typography controls
    font_family = models.CharField(max_length=20, choices=FONT_CHOICES, default="clash")
    font_size = models.PositiveIntegerField(default=44, help_text="Question heading size in px (24-96)")
    font_bold = models.BooleanField(default=True)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self):
        return f"{self.questionnaire.title} — Q{self.order + 1}"


class Choice(models.Model):
    question = models.ForeignKey(Question, on_delete=models.CASCADE, related_name="choices")
    text = models.CharField(max_length=200)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self):
        return self.text


class Response(models.Model):
    """A single participant response, kept for analytics. Live tally is in Redis."""
    question = models.ForeignKey(Question, on_delete=models.CASCADE, related_name="responses")
    session = models.ForeignKey("presentations.LiveSession", on_delete=models.CASCADE, related_name="poll_responses")
    participant_id = models.CharField(max_length=64)  # anonymous UUID
    choice = models.ForeignKey(Choice, on_delete=models.SET_NULL, null=True, blank=True)
    text_value = models.TextField(blank=True)
    numeric_value = models.FloatField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["question", "session"])]