from django.conf import settings
from django.db import models


class Quiz(models.Model):
    """A Kahoot-style game quiz."""

    SCORING_CHOICES = [
        ("speed", "Speed — first correct gets the points"),
        ("accuracy", "Accuracy — number of correct answers wins"),
    ]
    MODE_CHOICES = [
        ("orchestra", "Orchestra (presenter-controlled)"),
        ("open", "Open (self-paced)"),
    ]
    CHART_BG_CHOICES = [
        ("normal", "Normal"),
        ("space", "Outer Space"),
        ("forest", "Forest"),
        ("room", "Game Room"),
        ("binary", "Digital / Binary"),

        ("astronaut", "Astronaut"),
        ("whale_sea", "Whale in the Sea"),
        ("aquatic", "Aquatic"),
        ("waterfall", "Waterfall"),
        ("rainfall", "Rain Fall"),
        ("zombie", "Zombie Moving"),
        ("football", "Football"),
        ("soccer", "Soccer"),
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
        max_length=20,
        choices=CHART_BG_CHOICES,
        default="normal",
        help_text="Gamified scenery rendered behind the live chart.",
    )

    # ── Late-answer policy (synchronized server timer) ──
    # When `allow_late_answers` is False (default), the server REJECTS any
    # answer arriving after the question's deadline (time_limit + presenter
    # extensions). The participant sees "Time's up" and gets 0 points.
    #
    # When True, late answers are accepted but scored at a reduced rate
    # controlled by `late_answer_points_pct` (0 = no points, 100 = full).
    allow_late_answers = models.BooleanField(
        default=False,
        help_text="If on, answers can still be submitted after the timer ends.",
    )
    late_answer_points_pct = models.PositiveSmallIntegerField(
        default=0,
        help_text="Percent of normal points awarded for a correct LATE answer (0–100). Only used when 'allow late answers' is on.",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return self.title


class GameRoom(models.Model):
    """A named, avatar-decorated room participants can choose to join."""

    quiz = models.ForeignKey(Quiz, on_delete=models.CASCADE, related_name="rooms")
    slug = models.SlugField(max_length=40)
    name = models.CharField(max_length=60)
    avatar_id = models.CharField(max_length=30, default="dragon", help_text="Avatar shown on the room's door.")
    order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["order", "id"]
        unique_together = ("quiz", "slug")

    def __str__(self):
        return f"{self.name} ({self.slug})"


class GameQuestion(models.Model):
    """One live game question."""

    QUESTION_TYPE_CHOICES = [
        ("mcq", "Classic multiple choice"),
        ("picture_choice", "Select the correct picture"),
        ("puzzle", "Puzzle pieces"),
    ]

    FONT_CHOICES = [
        ("default", "Default (Inter)"),
        ("clash", "Clash Display (bold)"),
        ("space", "Space Grotesk"),
        ("serif", "Playfair Serif"),
        ("mono", "JetBrains Mono"),
        ("comic", "Comic Neue"),
        ("press", "Press Start 2P (8-bit)"),
    ]
    ALIGN_CHOICES = [("left", "Left"), ("center", "Center"), ("right", "Right")]
    SHAPE_CHOICES = [
        ("rounded", "Rounded rectangle"),
        ("square", "Square"),
        ("circle", "Circle"),
        ("triangle", "Triangle"),
        ("diamond", "Diamond"),
    ]

    quiz = models.ForeignKey(Quiz, on_delete=models.CASCADE, related_name="questions")
    question_type = models.CharField(max_length=30, choices=QUESTION_TYPE_CHOICES, default="mcq")
    text = models.CharField(max_length=500)
    image = models.ImageField(upload_to="game_question_images/", blank=True, null=True)
    time_limit = models.PositiveIntegerField(default=20, help_text="Seconds to answer")
    points = models.PositiveIntegerField(default=1000)
    order = models.PositiveIntegerField(default=0)

    font_family = models.CharField(max_length=20, choices=FONT_CHOICES, default="default")
    font_size = models.PositiveIntegerField(default=32, help_text="Question text size in pixels (16–96).")
    font_bold = models.BooleanField(default=True)
    text_italic = models.BooleanField(default=False)
    text_underline = models.BooleanField(default=False)
    text_align = models.CharField(max_length=10, choices=ALIGN_CHOICES, default="center")
    text_color = models.CharField(max_length=9, default="#f8fafc")
    background_color = models.CharField(max_length=9, default="#1e293b")
    background_gradient_to = models.CharField(max_length=9, blank=True, default="")
    answer_shape = models.CharField(max_length=12, choices=SHAPE_CHOICES, default="rounded")

    class Meta:
        ordering = ["order", "id"]

    def __str__(self):
        return self.text


class GameChoice(models.Model):
    question = models.ForeignKey(GameQuestion, on_delete=models.CASCADE, related_name="choices")
    text = models.CharField(max_length=200, blank=True)
    image = models.ImageField(upload_to="game_choice_images/", blank=True, null=True)
    is_correct = models.BooleanField(default=False)
    correct_position = models.PositiveIntegerField(default=0, help_text="For puzzle: 1 is first piece, 2 is second piece, etc.")
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self):
        return self.text or f"Choice {self.pk or ''}".strip()


class GameAnswer(models.Model):
    """Persisted answer for analytics; live scoring can still live in Redis."""

    question = models.ForeignKey(GameQuestion, on_delete=models.CASCADE)
    session = models.ForeignKey("presentations.LiveSession", on_delete=models.CASCADE, related_name="game_answers")
    participant_id = models.CharField(max_length=64)
    nickname = models.CharField(max_length=40)
    avatar_id = models.CharField(max_length=30, default="dragon")
    choice = models.ForeignKey(GameChoice, on_delete=models.SET_NULL, null=True, blank=True)
    puzzle_order = models.JSONField(default=list, blank=True)
    is_correct = models.BooleanField(default=False)
    time_taken_ms = models.PositiveIntegerField(default=0)
    points_awarded = models.IntegerField(default=0)
    was_late = models.BooleanField(default=False, help_text="True if submitted after the deadline (only stored when allow_late_answers is on).")
    room_id = models.CharField(max_length=40, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["session", "participant_id"])]