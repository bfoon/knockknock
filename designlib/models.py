"""Design library — bookmarked slide designs you can drop onto any slide.

A bookmark is a little bundle of Hanns slide elements (an AI-area result, or
anything you selected on a slide) stored relative to its own top-left corner,
so it can be placed, scaled and restyled anywhere, in any deck. Bookmarks
belong to a person, not a deck.

Kept in its own app on purpose: the `hanns` app has no committed migrations
(servers generate them locally), so a migration here would clash. This app's
migration depends only on the user model.
"""

from django.conf import settings
from django.db import models

MAX_PER_USER = 500
MAX_JSON_BYTES = 250_000


class DesignBookmark(models.Model):
    KIND_CHOICES = [("ai", "AI area"), ("selection", "Selection")]

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="design_bookmarks")
    name = models.CharField(max_length=80)
    kind = models.CharField(max_length=12, choices=KIND_CHOICES, default="selection")
    els = models.JSONField(default=list)          # elements, coordinates relative to (0, 0)
    w = models.PositiveIntegerField(default=100)
    h = models.PositiveIntegerField(default=100)
    prompt = models.CharField(max_length=600, blank=True, default="")   # AI-area prompt, for remixing
    tags = models.JSONField(default=list)
    color = models.CharField(max_length=32, blank=True, default="")    # dominant colour, for the card
    pinned = models.BooleanField(default=False)
    uses = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-pinned", "-last_used_at", "-created_at"]
        indexes = [models.Index(fields=["owner", "-created_at"])]

    def __str__(self):
        return f"{self.name} ({self.owner})"

    def as_dict(self):
        return {"id": self.id, "name": self.name, "kind": self.kind, "els": self.els, "w": self.w, "h": self.h,
                "prompt": self.prompt, "tags": self.tags, "color": self.color, "pinned": self.pinned,
                "uses": self.uses, "created": self.created_at.isoformat(),
                "lastUsed": self.last_used_at.isoformat() if self.last_used_at else None}
