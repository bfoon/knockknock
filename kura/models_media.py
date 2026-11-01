"""
kura/models_media.py — photos (and later audio/signatures) collected in a survey.

Until now a photo answer was only the file path ON THE PHONE (the collector
app synced answers as JSON and the image never left the device), and the
web runner took a typed reference. SubmissionMedia stores the real file.

* One row per (submission uuid, question path). The phone uploads its photos
  before the answers, so a row can exist before its Submission arrives; it
  is linked on the client_uuid the moment both exist (media.link_pending).
* Three files: the original (kept for download), a ≤1600 px "web" JPEG and
  a ≤480 px thumbnail — both with EXIF stripped and orientation applied.
* Files live under media/kura/private/<code>/<random>/ and are served ONLY
  through kura.media_views.media_file, which checks the viewer may see the
  survey's data. Add the nginx rule in FOON_README so /media/kura/private/
  is never served directly.
"""

import secrets

from django.conf import settings
from django.db import models


def _media_path(instance, filename):
    ext = (filename.rsplit(".", 1)[-1] if "." in filename else "jpg").lower()[:5]
    return f"kura/private/{instance.survey.code}/{instance.token}/original.{ext}"


def _web_path(instance, filename):
    return f"kura/private/{instance.survey.code}/{instance.token}/web.jpg"


def _thumb_path(instance, filename):
    return f"kura/private/{instance.survey.code}/{instance.token}/thumb.jpg"


def _token():
    return secrets.token_hex(16)


class SubmissionMedia(models.Model):
    KIND_CHOICES = [("photo", "Photo"), ("signature", "Signature"), ("audio", "Audio")]

    survey = models.ForeignKey("kura.Survey", on_delete=models.CASCADE, related_name="media")
    submission = models.ForeignKey("kura.Submission", on_delete=models.CASCADE, null=True, blank=True,
                                   related_name="media")
    client_uuid = models.UUIDField(db_index=True)
    question = models.CharField(max_length=160)          # "water_photo" or "members|0|photo"
    kind = models.CharField(max_length=12, choices=KIND_CHOICES, default="photo")
    token = models.CharField(max_length=40, default=_token, editable=False, unique=True)

    file = models.FileField(upload_to=_media_path, max_length=255)
    web = models.FileField(upload_to=_web_path, max_length=255, blank=True)
    thumb = models.FileField(upload_to=_thumb_path, max_length=255, blank=True)
    content_type = models.CharField(max_length=60, blank=True)
    size = models.PositiveIntegerField(default=0)
    width = models.PositiveIntegerField(default=0)
    height = models.PositiveIntegerField(default=0)
    original_name = models.CharField(max_length=160, blank=True)

    captured_at = models.DateTimeField(null=True, blank=True)     # from EXIF when the phone kept it
    gps_lat = models.FloatField(null=True, blank=True)            # from EXIF, else the submission
    gps_lng = models.FloatField(null=True, blank=True)

    caption = models.TextField(blank=True)
    starred = models.BooleanField(default=False, db_index=True)   # "use this one" in reports and decks
    hidden = models.BooleanField(default=False, db_index=True)    # kept, but out of galleries/reports
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                    related_name="+")
    source = models.CharField(max_length=10, default="app")        # app | web
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            models.UniqueConstraint(fields=["survey", "client_uuid", "question"], name="kura_media_one_per_answer"),
        ]
        indexes = [models.Index(fields=["survey", "hidden", "starred"])]

    def __str__(self):
        return f"{self.survey.code} · {self.question} · {self.client_uuid}"

    @property
    def question_name(self):
        """The schema question name ("photo" for "members|0|photo")."""
        return self.question.split("|")[-1]
