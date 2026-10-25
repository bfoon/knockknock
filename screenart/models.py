"""Event backgrounds for a Hanns Big Screen.

The host uploads event artwork (a welcome slide, sponsor boards, the event
poster) from the big screen's pull-down panel, then shows it full screen —
over the lobby or even over a deck that's playing — with optional dimming,
a slow cinematic zoom, a slideshow, a caption and a live countdown.

Kept out of the `hanns` app on purpose: hanns has no committed migrations
(servers generate them), so a new hanns model or field would need a manual
step on every server. Here the screen is referred to by its id only, and
this app's migration depends on nothing.
"""

import uuid

from django.db import models

MAX_IMAGES_PER_SCREEN = 24

DEFAULT_STYLE = {
    "active": None,       # image id shown (first of the slideshow)
    "show": False,        # full screen right now, over everything
    "lobby": True,        # also behind the lobby card
    "fit": "cover",       # cover | contain
    "dim": 20,            # 0..80 %
    "motion": "drift",    # still | drift
    "slideshow": 0,       # seconds per image, 0 = off
    "caption": "",
    "countdown": "",      # "HH:MM" local time, "" = none
    "code": False,        # small share-code chip while showing
}


class ScreenBackdrop(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    screen_id = models.UUIDField(db_index=True)
    image = models.FileField(upload_to="hanns/screens/")
    width = models.PositiveIntegerField(default=0)
    height = models.PositiveIntegerField(default=0)
    name = models.CharField(max_length=120, blank=True, default="")
    position = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["position", "created_at"]

    def __str__(self):
        return f"{self.name or self.image.name} ({self.screen_id})"


class ScreenStyle(models.Model):
    screen_id = models.UUIDField(unique=True)
    settings = models.JSONField(default=dict)
    updated_at = models.DateTimeField(auto_now=True)

    def merged(self):
        out = dict(DEFAULT_STYLE)
        out.update({k: v for k, v in (self.settings or {}).items() if k in DEFAULT_STYLE})
        return out
