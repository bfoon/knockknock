from django.conf import settings
from django.db import models


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
