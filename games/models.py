from django.conf import settings
from django.db import models


class Quiz(models.Model):
    """A Kahoot-style game quiz."""

    SCORING_CHOICES = [
        ("speed",    "Speed — first correct gets the points"),
        ("accuracy", "Accuracy — number of correct answers wins"),
    ]
    MODE_CHOICES = [
        ("orchestra", "Orchestra (presenter-controlled)"),
        ("open",      "Open (self-paced)"),
    ]
    CHART_BG_CHOICES = [
        ("normal",  "Normal"),
        ("space",   "Outer Space"),
        ("forest",  "Forest"),
        ("room",    "Game Room"),
        ("binary",  "Digital / Binary"),
    ]

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="quizzes")
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    template_id = models.CharField(max_length=40, default="neon_gaming")
    logo = models.ImageField(upload_to="quiz_logos/", blank=True, null=True)
    scoring = models.CharField(max_length=20, choices=SCORING_CHOICES, default="speed")
    mode = models.CharField(max_length=20, choices=MODE_CHOICES, default="orchestra")
    use_rooms = models.BooleanField(default=False, help_text="If true, participants are split into capped rooms.")
    room_capacity = models.PositiveIntegerField(default=10)
    chart_background = models.CharField(
        max_length=20, choices=CHART_BG_CHOICES, default="normal",
        help_text="Gamified scenery rendered behind the live chart.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return self.title


class GameQuestion(models.Model):
    FONT_CHOICES = [
        ("default",        "Default (Inter)"),
        ("clash",          "Clash Display (bold)"),
        ("space",          "Space Grotesk"),
        ("serif",          "Playfair Serif"),
        ("mono",           "JetBrains Mono"),
        ("comic",          "Comic Neue"),
        ("press",          "Press Start 2P (8-bit)"),
    ]

    quiz = models.ForeignKey(Quiz, on_delete=models.CASCADE, related_name="questions")
    text = models.CharField(max_length=500)
    image = models.ImageField(upload_to="game_question_images/", blank=True, null=True)
    time_limit = models.PositiveIntegerField(default=20, help_text="Seconds to answer")
    points = models.PositiveIntegerField(default=1000)
    order = models.PositiveIntegerField(default=0)

    # ── Typography (applies to the question text both in editor preview
    #               and on the presenter/participant screens).
    font_family = models.CharField(max_length=20, choices=FONT_CHOICES, default="default")
    font_size = models.PositiveIntegerField(
        default=32,
        help_text="Question text size in pixels (16–96).",
    )
    font_bold = models.BooleanField(default=True)

    class Meta:
        ordering = ["order", "id"]


class GameChoice(models.Model):
    question = models.ForeignKey(GameQuestion, on_delete=models.CASCADE, related_name="choices")
    text = models.CharField(max_length=200)
    is_correct = models.BooleanField(default=False)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["order", "id"]


class GameAnswer(models.Model):
    """Persisted answer for analytics; live scoring lives in Redis."""
    question = models.ForeignKey(GameQuestion, on_delete=models.CASCADE)
    session = models.ForeignKey("presentations.LiveSession", on_delete=models.CASCADE, related_name="game_answers")
    participant_id = models.CharField(max_length=64)
    nickname = models.CharField(max_length=40)
    avatar_id = models.CharField(max_length=30, default="dragon")
    choice = models.ForeignKey(GameChoice, on_delete=models.SET_NULL, null=True)
    is_correct = models.BooleanField(default=False)
    time_taken_ms = models.PositiveIntegerField(default=0)
    points_awarded = models.IntegerField(default=0)
    room_id = models.CharField(max_length=40, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["session", "participant_id"])]