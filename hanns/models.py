"""
hanns/models.py — data model for the Hanns presentation studio.

Two tables: a Deck (one presentation, owner + join code, mirrors the shape
of BoardSession so it can share the same dashboard / session-code
machinery) and ordered Slides. A slide's visual content lives in a single
JSON ``data`` blob whose shape is exactly what the editor and the live
player consume:

    {
      "bg": "<css background>",
      "bgSize": "<css background-size or null>",
      "transition": "fade|slide|push|zoom|flip|reveal|none",
      "els": [ {id,type,x,y,w,h,rot,anim,animDelay, …type-specific…}, … ]
    }

Keeping the element list as JSON (rather than a row per element) matches
how the front-end already works, makes save/load a single round-trip, and
keeps the live WebSocket layer thin — the socket only carries slide-sync
and audience reactions, never element edits.
"""

import random
import string

from django.conf import settings
from django.db import models


def _gen_code(length=6):
    """Short, unambiguous join code (no 0/O/1/I) — same alphabet as Boardly."""
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(random.choice(alphabet) for _ in range(length))


class Deck(models.Model):
    STATE_CHOICES = [
        ("draft", "Draft"),        # being edited, not presenting
        ("live", "Live"),          # presenter is presenting
        ("ended", "Ended"),        # presentation finished
    ]

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name="hanns_decks", null=True, blank=True,
    )
    code = models.CharField(max_length=12, unique=True, db_index=True)
    title = models.CharField(max_length=140, default="Untitled deck")
    state = models.CharField(max_length=10, choices=STATE_CHOICES, default="draft")

    # Whether the audience may send live emoji reactions while presenting.
    allow_reactions = models.BooleanField(default=True)

    # The slide the presenter is currently on. Lets a (re)connecting
    # audience phone or a second presenter screen sync to the right slide.
    current_slide = models.PositiveIntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return f"{self.title} ({self.code})"

    def save(self, *args, **kwargs):
        if not self.code:
            code = _gen_code()
            while Deck.objects.filter(code=code).exists():
                code = _gen_code()
            self.code = code
        super().save(*args, **kwargs)

    @property
    def is_live(self):
        return self.state == "live"

    def as_dict(self):
        """Full serialised deck — what the editor loads and the player runs."""
        return {
            "title": self.title,
            "code": self.code,
            "state": self.state,
            "allow_reactions": self.allow_reactions,
            "current_slide": self.current_slide,
            "slides": [s.as_dict() for s in self.slides.all()],
        }


class Slide(models.Model):
    """One slide in a deck. Visual content lives in ``data`` (see module doc)."""
    deck = models.ForeignKey(
        Deck, on_delete=models.CASCADE, related_name="slides",
    )
    position = models.PositiveIntegerField(default=0)

    # The full slide payload: {bg, bgSize, transition, els:[…]}.
    data = models.JSONField(default=dict)

    class Meta:
        ordering = ["position", "id"]

    def __str__(self):
        return f"slide {self.position} of deck {self.deck_id}"

    def as_dict(self):
        # The stored blob already matches the client's slide shape; we just
        # ensure the keys exist so an older/partial row never breaks render.
        d = dict(self.data or {})
        d.setdefault("bg", "#f6f1e7")
        d.setdefault("bgSize", None)
        d.setdefault("bgFx", "none")
        d.setdefault("transition", "fade")
        d.setdefault("els", [])
        # Carry the server id so the editor can map slides back to rows.
        d["id"] = self.id
        d["position"] = self.position
        return d
