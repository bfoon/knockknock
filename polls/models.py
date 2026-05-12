from django.conf import settings
from django.db import models

from .question_types import QUESTION_TYPE_REGISTRY, type_choices


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

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="questionnaires",
    )
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    template_id = models.CharField(max_length=40, default="space_hud")
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
        return self.collaborators.filter(
            user=user, role__in=["edit", "owner"],
        ).exists()


class QuestionnaireCollaborator(models.Model):
    ROLE_CHOICES = [
        ("view", "Can view"),
        ("edit", "Can edit"),
    ]
    questionnaire = models.ForeignKey(
        Questionnaire, on_delete=models.CASCADE, related_name="collaborators",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name="collaborations",
    )
    role = models.CharField(max_length=10, choices=ROLE_CHOICES, default="edit")
    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, related_name="sent_invites",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("questionnaire", "user")
        ordering = ["created_at"]

    def __str__(self):
        return f"{self.user} on {self.questionnaire} ({self.role})"


class Question(models.Model):
    """
    A single question. The 'type' drives which fields and storage table
    the participant flow uses — see polls.question_types for the full registry.
    """

    questionnaire = models.ForeignKey(
        Questionnaire, on_delete=models.CASCADE, related_name="questions",
    )
    text = models.CharField(max_length=500)
    type = models.CharField(max_length=20, choices=type_choices(), default="mcq")
    chart_type = models.CharField(max_length=30, default="bar")
    order = models.PositiveIntegerField(default=0)
    image = models.ImageField(upload_to="question_images/", blank=True, null=True)

    # ── Typography ────────────────────────────────
    font_family = models.CharField(max_length=20, choices=FONT_CHOICES, default="clash")
    font_size = models.PositiveIntegerField(
        default=44, help_text="Question heading size in px (24–96)",
    )
    font_bold = models.BooleanField(default=True)

    # ── Per-question flexibility (NEW) ────────────
    time_limit_seconds = models.PositiveIntegerField(
        null=True, blank=True,
        help_text="If set, participants have this many seconds to answer. "
                  "Leave blank for no time limit.",
    )
    is_required = models.BooleanField(
        default=True,
        help_text="If false, participants can skip this question.",
    )
    is_anonymous = models.BooleanField(
        default=True,
        help_text="If false, the participant's nickname will be stored with their answer.",
    )
    min_selections = models.PositiveIntegerField(
        null=True, blank=True,
        help_text="MCQ / image-choice only — minimum options participant must pick.",
    )
    max_selections = models.PositiveIntegerField(
        null=True, blank=True,
        help_text="MCQ / image-choice only — maximum options participant can pick. "
                  "1 = single-choice. Blank = unlimited.",
    )
    template_id_override = models.CharField(
        max_length=40, blank=True,
        help_text="Override the questionnaire's template just for this slide.",
    )

    # ── Skip / branch logic (NEW) ─────────────────
    # Shape: [{"if_choice_id": 17, "jump_to_order": 4},
    #         {"if_value_min": 0, "if_value_max": 6, "jump_to_order": 9}, ...]
    # Evaluated in order; first match wins. Empty list = linear flow.
    skip_rules = models.JSONField(
        default=list, blank=True,
        help_text="Branching rules. See docs.",
    )

    # ── Type-specific config (NEW) ────────────────
    # Free-form JSON so each type can store what it needs without 30 nullable cols.
    # Examples per type — see polls.question_types for the canonical reference:
    #   slider:    {"min": 0, "max": 100, "step": 1, "unit": "%"}
    #   rating:    {"max_stars": 5}
    #   nps:       {}  (always 0–10)
    #   numeric:   {"min": null, "max": null, "decimals": 0}
    #   pin_image: {} (uses Question.image)
    #   pin_map:   {"center_lat": 0, "center_lng": 0, "zoom": 2}
    #   two_by_two:{"x_left": "Hard", "x_right": "Easy",
    #               "y_bottom": "Low impact", "y_top": "High impact"}
    #   matrix:    {"scale_min": 1, "scale_max": 5, "scale_labels": ["Bad", ..., "Great"]}
    #   points:    {"total": 100}
    #   date/time: {"min": "2024-01-01", "max": "2026-12-31"}
    #   file:      {"max_size_mb": 10, "accept": "image/*"}
    config = models.JSONField(default=dict, blank=True)

    # ── Title-slide fields (NEW; only used when type == "title") ──
    TITLE_LAYOUT_CHOICES = [
        ("clean",   "Clean (title + subtitle + optional logo)"),
        ("quote",   "Quote (oversize quotation with author)"),
        ("divider", "Section divider (numbered)"),
    ]
    subtitle = models.CharField(
        max_length=500, blank=True,
        help_text="Subtitle / kicker / quote body — used by title slides.",
    )
    title_layout = models.CharField(
        max_length=20, choices=TITLE_LAYOUT_CHOICES, default="clean", blank=True,
        help_text="Visual layout for title slides.",
    )
    title_image = models.ImageField(
        upload_to="title_slide_images/", blank=True, null=True,
        help_text="Optional logo / hero image for the title slide.",
    )
    title_author = models.CharField(
        max_length=200, blank=True,
        help_text="Attribution shown on the 'quote' layout.",
    )

    class Meta:
        ordering = ["order", "id"]

    def __str__(self):
        return f"{self.questionnaire.title} — Q{self.order + 1}"

    # ── Helpers ────────────────────────────────────
    def meta(self):
        """Registry metadata for this question's type."""
        return QUESTION_TYPE_REGISTRY.get(self.type, {})

    def has_choices(self):
        return self.meta().get("has_choices", False)

    def is_static(self):
        return bool(self.meta().get("is_static"))

    def storage(self):
        return self.meta().get("storage")

    def effective_template_id(self):
        return self.template_id_override or self.questionnaire.template_id


class MatrixRow(models.Model):
    """A sub-row for matrix-type questions."""
    question = models.ForeignKey(
        Question, on_delete=models.CASCADE, related_name="matrix_rows",
    )
    text = models.CharField(max_length=200)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self):
        return self.text


class Choice(models.Model):
    question = models.ForeignKey(
        Question, on_delete=models.CASCADE, related_name="choices",
    )
    text = models.CharField(max_length=200)
    order = models.PositiveIntegerField(default=0)
    # NEW: optional image (for image_choice questions)
    image = models.ImageField(upload_to="choice_images/", blank=True, null=True)
    # NEW: weight (used by ranking aggregation and points_allocation max-per-choice caps)
    weight = models.FloatField(default=0)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self):
        return self.text


class Response(models.Model):
    """
    Persistent participant answer. The set of fields used depends on the
    question's storage type — see polls.question_types.
    """

    question = models.ForeignKey(
        Question, on_delete=models.CASCADE, related_name="responses",
    )
    session = models.ForeignKey(
        "presentations.LiveSession",
        on_delete=models.CASCADE, related_name="poll_responses",
    )
    participant_id = models.CharField(max_length=64)
    # Used only when is_anonymous=False on the question.
    nickname = models.CharField(max_length=80, blank=True)

    # ── Storage fields (one or more populated per response) ──
    choice = models.ForeignKey(
        Choice, on_delete=models.SET_NULL, null=True, blank=True,
    )
    text_value = models.TextField(blank=True)
    numeric_value = models.FloatField(null=True, blank=True)

    # NEW: date / datetime / time → stored in datetime_value
    # (time-only is stored with the date set to 1970-01-01)
    datetime_value = models.DateTimeField(null=True, blank=True)

    # NEW: uploaded file
    file_value = models.FileField(upload_to="response_uploads/%Y/%m/", blank=True, null=True)

    # NEW: spatial / 2×2 coordinates
    x_value = models.FloatField(null=True, blank=True)
    y_value = models.FloatField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["question", "session"]),
            models.Index(fields=["session", "participant_id"]),
        ]
        constraints = [
            # NOTE: for MCQ/image-choice with max_selections > 1, a single
            # participant submits MULTIPLE responses for the same question
            # (one row per selected choice). For all other types it's 1-per-pair.
            # We enforce uniqueness only when choice is null (single-value types)
            # via the partial unique constraint below.
            models.UniqueConstraint(
                fields=["question", "session", "participant_id"],
                condition=models.Q(choice__isnull=True),
                name="unique_singlevalue_response_per_participant",
            ),
        ]

    def __str__(self):
        return f"{self.session} · {self.question_id} · {self.participant_id}"


class MatrixAnswer(models.Model):
    """One numeric answer per (matrix question, matrix row, participant)."""
    question = models.ForeignKey(
        Question, on_delete=models.CASCADE, related_name="matrix_answers",
    )
    matrix_row = models.ForeignKey(
        MatrixRow, on_delete=models.CASCADE, related_name="answers",
    )
    session = models.ForeignKey(
        "presentations.LiveSession",
        on_delete=models.CASCADE, related_name="matrix_answers",
    )
    participant_id = models.CharField(max_length=64)
    numeric_value = models.FloatField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["question", "matrix_row", "session", "participant_id"],
                name="unique_matrix_answer_per_row_per_participant",
            ),
        ]
        indexes = [models.Index(fields=["question", "session"])]


class PointsAllocation(models.Model):
    """One allocation row per (points_allocation question, choice, participant).

    Sum of `points` across all rows for the same (question, session, participant)
    must equal `Question.config['total']` (default 100). Enforced at form-validation
    time, not at the DB level (so partial saves don't get blocked).
    """
    question = models.ForeignKey(
        Question, on_delete=models.CASCADE, related_name="points_allocations",
    )
    choice = models.ForeignKey(Choice, on_delete=models.CASCADE)
    session = models.ForeignKey(
        "presentations.LiveSession",
        on_delete=models.CASCADE, related_name="points_allocations",
    )
    participant_id = models.CharField(max_length=64)
    points = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["question", "choice", "session", "participant_id"],
                name="unique_points_alloc_per_choice_per_participant",
            ),
        ]
        indexes = [models.Index(fields=["question", "session"])]