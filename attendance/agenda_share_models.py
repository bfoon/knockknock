"""
Public agenda links — share an event's agenda with anyone, no sign-in.

An organizer can make as many links as they like for one event, each
with its own label ("WhatsApp group", "Printed flyer", "Partners"), so a
link that ends up in the wrong place can be stopped without breaking the
others. Each link:

  • is an unguessable token in the URL (/attendance/a/<token>/);
  • can be stopped and resumed at any time (same URL comes back);
  • can stop itself a day after the event ends (`stop_after_event`);
  • counts how often it's opened, so the organizer sees which ones are used.

The public page shows only what's on the agenda — event title, dates,
venue and sessions. Never registrations, never attendee data.

Kept in its own module, like feedback_models.py / badge_models.py.
models.py imports it so Django registers the model at start-up.
"""

import secrets
from datetime import timedelta

from django.conf import settings
from django.db import models
from django.urls import reverse
from django.utils import timezone


# How long after the event ends an auto-stopping link keeps working —
# long enough for "what time was that talk?" the evening after.
AUTO_STOP_GRACE = timedelta(hours=24)


def _gen_share_token():
    # 16 random bytes → 22 URL-safe characters. Not guessable, not
    # derived from the event id.
    return secrets.token_urlsafe(16)


class AgendaShareLink(models.Model):
    STATE_LIVE = "live"
    STATE_STOPPED = "stopped"
    STATE_EXPIRED = "expired"

    event = models.ForeignKey(
        "attendance.AttendanceEvent",
        on_delete=models.CASCADE,
        related_name="agenda_share_links",
    )
    token = models.CharField(
        max_length=40, unique=True, default=_gen_share_token, editable=False,
    )
    label = models.CharField(
        max_length=80, blank=True,
        help_text="Where this link is going, e.g. 'WhatsApp group'. Only you see it.",
    )
    is_active = models.BooleanField(default=True)
    stop_after_event = models.BooleanField(
        default=True,
        help_text="Stop working automatically a day after the event ends.",
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    stopped_at = models.DateTimeField(null=True, blank=True)

    view_count = models.PositiveIntegerField(default=0)
    last_viewed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.label or 'Agenda link'} → {self.event.title}"

    # ── State ────────────────────────────────────────────────────

    def expires_at(self):
        """When an auto-stopping link stops, or None if it never does."""
        if not self.stop_after_event:
            return None
        return self.event.ends_at + AUTO_STOP_GRACE

    def state(self, now=None):
        if not self.is_active:
            return self.STATE_STOPPED
        expires = self.expires_at()
        if expires and (now or timezone.now()) > expires:
            return self.STATE_EXPIRED
        return self.STATE_LIVE

    def is_live(self, now=None):
        return self.state(now) == self.STATE_LIVE

    def stop(self):
        self.is_active = False
        self.stopped_at = timezone.now()
        self.save(update_fields=["is_active", "stopped_at"])

    def resume(self):
        """
        Share again on the same URL. If it had expired, resuming also
        switches auto-stop off — otherwise it would expire again at once.
        """
        self.is_active = True
        self.stopped_at = None
        fields = ["is_active", "stopped_at"]
        if self.stop_after_event and self.state() == self.STATE_EXPIRED:
            self.stop_after_event = False
            fields.append("stop_after_event")
        self.save(update_fields=fields)

    # ── URLs ─────────────────────────────────────────────────────

    def get_public_url(self):
        return reverse("attendance:public_agenda", kwargs={"token": self.token})
