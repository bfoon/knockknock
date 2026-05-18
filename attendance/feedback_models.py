"""
Post-event feedback for the attendance app.

The organizer designs a short survey (questions, types, order) at any
time. After the event is marked Ended, they flip the survey "active".
While the survey is active, any scan of the event-level walk-in QR
OR a personal ticket QR routes to the feedback page instead of the
check-in / ticket flows.

Anonymous submitters are allowed (anyone can scan the printed QR).
If the visitor came in via their personal ticket link, we attach the
Registration so the organizer can see who said what — anonymous scans
stay anonymous.

Kept in its own module (mirrors venue_models.py) so the diff against
the large main models.py is just one import line in urls/views and a
related_name=`feedback_survey` reverse accessor on AttendanceEvent
(via the FK declared here).
"""

from django.conf import settings
from django.db import models


class FeedbackSurvey(models.Model):
    """
    Exactly one survey per event. Created lazily the first time an
    organizer opens the Feedback editor, so events without feedback
    don't have stray rows.
    """

    event = models.OneToOneField(
        "attendance.AttendanceEvent",
        on_delete=models.CASCADE,
        related_name="feedback_survey",
    )
    is_active = models.BooleanField(
        default=False,
        help_text="When on, scans land on the survey instead of check-in/ticket. "
                  "The view layer additionally gates this on the event being Ended.",
    )
    intro_text = models.TextField(
        blank=True,
        help_text="Optional intro shown above the survey questions on the "
                  "public page. Keep it short — one or two sentences.",
    )
    thanks_text = models.TextField(
        blank=True,
        help_text="Optional thank-you message shown after submission. "
                  "Defaults to a generic 'Thanks for your feedback!' if blank.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Feedback survey"
        verbose_name_plural = "Feedback surveys"

    def __str__(self):
        return f"Survey for {self.event.title}"

    def can_accept_responses(self):
        """
        Survey-level gate used by the public view. Survey must be on,
        AND the event must be Ended — admin can author questions while
        the event is still live, but the public page won't accept
        responses until the event has ended.
        """
        from .models import AttendanceEvent  # local to avoid import cycle
        return bool(self.is_active and self.event.status == AttendanceEvent.STATUS_ENDED)


class FeedbackQuestion(models.Model):
    """
    One question on a survey. The `choices` JSON field carries the
    options for `multiple_choice`; the other types ignore it.

      open_text       — free-form textarea
      rate_1_5        — 1–5 star/number rating
      multiple_choice — single-select from a list of options
      yes_no          — boolean

    `required` defaults False so the survey is friction-light by
    default; organizers can flip individual questions on.
    """

    TYPE_OPEN_TEXT = "open_text"
    TYPE_RATE_1_5 = "rate_1_5"
    TYPE_MULTIPLE_CHOICE = "multiple_choice"
    TYPE_YES_NO = "yes_no"
    # Separator: not a question. Renders as a section header with the
    # `text` field used as the title. No answer is ever stored for a
    # separator row — the public form and the results page both skip
    # them when iterating answerable questions. We keep them in the
    # same table so ordering, drag-reorder, and the editor stay simple.
    TYPE_SEPARATOR = "separator"
    TYPE_CHOICES = [
        (TYPE_OPEN_TEXT,       "Open text"),
        (TYPE_RATE_1_5,        "Rating (1–5)"),
        (TYPE_MULTIPLE_CHOICE, "Multiple choice"),
        (TYPE_YES_NO,          "Yes / No"),
        (TYPE_SEPARATOR,       "Section title (separator)"),
    ]

    # Types that actually collect an answer from the respondent. Used
    # by helper code that needs to iterate "real" questions only.
    ANSWERABLE_TYPES = {
        TYPE_OPEN_TEXT, TYPE_RATE_1_5, TYPE_MULTIPLE_CHOICE, TYPE_YES_NO,
    }

    survey = models.ForeignKey(
        FeedbackSurvey,
        on_delete=models.CASCADE,
        related_name="questions",
    )
    text = models.CharField(max_length=400)
    question_type = models.CharField(max_length=20, choices=TYPE_CHOICES,
                                     default=TYPE_OPEN_TEXT)
    # Only used for multiple_choice. List[str]. Empty for other types.
    choices = models.JSONField(default=list, blank=True)
    required = models.BooleanField(default=False)
    order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["order", "id"]
        indexes = [models.Index(fields=["survey", "order"])]

    def __str__(self):
        return self.text[:60]

    def is_separator(self):
        return self.question_type == self.TYPE_SEPARATOR

    def is_answerable(self):
        return self.question_type in self.ANSWERABLE_TYPES

    def cleaned_choices(self):
        """Return choices as a list of trimmed non-empty strings."""
        out = []
        for c in (self.choices or []):
            s = str(c).strip()
            if s:
                out.append(s)
        return out


class FeedbackResponse(models.Model):
    """
    One row per submission. Anonymous unless the visitor came in via a
    personal ticket QR, in which case we attach their Registration.
    `submitter_name` is denormalized so the organizer's results page
    doesn't have to follow the FK to render names (and so a name
    survives if the Registration is later cancelled).
    """

    survey = models.ForeignKey(
        FeedbackSurvey,
        on_delete=models.CASCADE,
        related_name="responses",
    )
    registration = models.ForeignKey(
        "attendance.Registration",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="feedback_responses",
    )
    submitter_name = models.CharField(max_length=160, blank=True)
    submitted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-submitted_at"]
        indexes = [models.Index(fields=["survey", "submitted_at"])]

    def __str__(self):
        who = self.submitter_name or "Anonymous"
        return f"{who} — {self.submitted_at:%Y-%m-%d %H:%M}"

    def display_name(self):
        return self.submitter_name or "Anonymous"


class FeedbackAnswer(models.Model):
    """
    One row per (response, question). Storing the value in three
    typed columns keeps results queries simple (no JSON unpacking for
    aggregation), while still letting one model carry every type.

    Only one of `text_answer`, `rating`, `choice_answer`, `bool_answer`
    is populated per row depending on the question type.
    """

    response = models.ForeignKey(
        FeedbackResponse,
        on_delete=models.CASCADE,
        related_name="answers",
    )
    question = models.ForeignKey(
        FeedbackQuestion,
        on_delete=models.CASCADE,
        related_name="answers",
    )

    text_answer = models.TextField(blank=True)
    rating = models.PositiveSmallIntegerField(null=True, blank=True)
    choice_answer = models.CharField(max_length=300, blank=True)
    bool_answer = models.BooleanField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("response", "question"),
                name="uniq_feedback_answer_per_question",
            ),
        ]
        indexes = [models.Index(fields=["question"])]

    def __str__(self):
        return f"Answer to {self.question_id}"

    def display_value(self):
        """Human-readable answer for the results page."""
        t = self.question.question_type
        if t == FeedbackQuestion.TYPE_OPEN_TEXT:
            return self.text_answer or ""
        if t == FeedbackQuestion.TYPE_RATE_1_5:
            return f"{self.rating}/5" if self.rating else ""
        if t == FeedbackQuestion.TYPE_MULTIPLE_CHOICE:
            return self.choice_answer or ""
        if t == FeedbackQuestion.TYPE_YES_NO:
            if self.bool_answer is True:
                return "Yes"
            if self.bool_answer is False:
                return "No"
            return ""
        return ""