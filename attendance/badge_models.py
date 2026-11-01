"""
Printable name badges for the attendance app.

Kept in its own module (same pattern as venue_models.py / feedback_models.py)
so nothing in the large models.py changes. The models are registered with
Django when urls.py imports badge_views → badge_models, exactly the way the
feedback models are.

Design philosophy
-----------------
A badge design is ONE JSON document (BadgeDesign.layout) describing the
badge size, background and a list of positioned elements (text with
{tokens}, QR codes, images, shapes). The built-in templates live in
static/attendance/badges/badge_templates.js — picking one copies its JSON
into the event's design, after which the organiser can change anything
without affecting any other event. The same JS renderer
(badge_render.js) draws the badge in the designer, in the template
gallery and on the print sheet, so what you see is what prints.

Three tables:
  BadgeDesign          one per event, created lazily on first visit
  BadgeAsset           extra uploaded images (logos, sponsor strips, seals)
  SavedBadgeTemplate   "My templates" — a design saved for reuse on other
                       events, owned by the user
"""

from django.conf import settings
from django.db import models


class BadgeDesign(models.Model):
    event = models.OneToOneField(
        "attendance.AttendanceEvent",
        on_delete=models.CASCADE,
        related_name="badge_design",
    )
    # Key of the built-in template the design started from. Informational
    # only — the layout JSON is the source of truth.
    template_key = models.CharField(max_length=40, blank=True, default="")
    layout = models.JSONField(default=dict, blank=True)
    # The organiser's background photo. Referenced from the layout as
    # bg.img = "background" (or by an image element with src "background").
    background = models.ImageField(
        upload_to="events/badges/backgrounds/", blank=True, null=True,
    )
    # Remembered print-sheet settings (paper, margins, gap, crop marks…)
    # so the per-attendee "print badge" button uses the same setup.
    print_opts = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Badge design · {self.event}"


class BadgeAsset(models.Model):
    """An extra image an organiser uploaded for use on badges."""

    design = models.ForeignKey(
        BadgeDesign, on_delete=models.CASCADE, related_name="assets",
    )
    image = models.ImageField(upload_to="events/badges/assets/")
    label = models.CharField(max_length=120, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.label or f"Badge asset #{self.pk}"


class SavedBadgeTemplate(models.Model):
    """A user's own badge template, reusable across all their events."""

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="saved_badge_templates",
    )
    name = models.CharField(max_length=120)
    layout = models.JSONField(default=dict, blank=True)
    background = models.ImageField(
        upload_to="events/badges/library/", blank=True, null=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.name
