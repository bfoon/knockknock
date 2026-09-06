"""
hanns/models.py — data model for the Hanns presentation studio.

The core two tables: a Deck (one presentation, owner + join code, mirrors the shape
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
import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone


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

    # ── audience download (end-of-presentation QR) ───────────────────
    # When the presenter ends the show, the big screen can display a QR the
    # room scans to download the deck as a standalone .html file. That page
    # is PUBLIC, so it is gated on an explicit opt-in plus an unguessable
    # token rather than on the deck code (which is short and shoulder-
    # surfable). Rotating the token instantly kills every old QR.
    allow_download = models.BooleanField(
        default=False,
        help_text="Let the audience download this deck from the end-of-show QR.",
    )
    download_token = models.UUIDField(default=uuid.uuid4, editable=False)

    def rotate_download_token(self):
        """Invalidate every QR handed out so far."""
        self.download_token = uuid.uuid4()
        self.save(update_fields=["download_token"])
        return self.download_token

    # ── review link (view-only share) ────────────────────────────────
    # A reviewer opens the deck read-only from an unguessable token URL:
    # no account, no editing, no presenter material. Same reasoning as
    # download_token — the deck code is short and shoulder-surfable, so
    # the token is the credential and rotating it kills every old link.
    #
    # The review URL carries ONLY the token, never the code. The code is
    # the key to the audience page and the presenter controller, so a link
    # handed to an outside reviewer must not contain it.
    allow_review = models.BooleanField(
        default=False,
        help_text="Let anyone with the review link open this deck read-only.",
    )
    review_token = models.UUIDField(default=uuid.uuid4, editable=False)

    # Optional deadline. Null means "until I say otherwise" — the switch
    # and the token are the hard stops; this is the one that does not need
    # the owner to remember.
    review_expires_at = models.DateTimeField(
        null=True, blank=True,
        help_text="When the review link stops opening. Blank means no deadline.",
    )

    def rotate_review_token(self):
        """Invalidate every review link shared so far."""
        self.review_token = uuid.uuid4()
        self.save(update_fields=["review_token"])
        return self.review_token

    @property
    def review_expired(self):
        return bool(
            self.review_expires_at and self.review_expires_at <= timezone.now()
        )

    def review_link_active(self):
        """True when the review link should still open."""
        return bool(self.allow_review) and not self.review_expired

    @property
    def link_editor_count(self):
        """How many editors came in through the review link."""
        return DeckCollaborator.objects.filter(
            deck=self, source=DeckCollaborator.SOURCE_REVIEW_LINK,
        ).count()

    def revoke_link_editors(self, by_user=None):
        """Remove everyone who got edit rights through the review link.

        Deleting the DeckCollaborator row is the whole revocation: the
        dashboard query, the editor view, the save endpoint and the
        WebSocket all read that one table, so the deck stops appearing and
        stops opening for them. Their old request is marked revoked rather
        than deleted, so the history survives and they can ask again.

        People invited by email are untouched. Switching off a share link
        should not evict someone the owner let in personally.
        """
        editors = DeckCollaborator.objects.filter(
            deck=self, source=DeckCollaborator.SOURCE_REVIEW_LINK,
        )
        user_ids = list(editors.values_list("user_id", flat=True))
        removed = editors.count()
        editors.delete()
        if user_ids:
            DeckAccessRequest.objects.filter(
                deck=self, user_id__in=user_ids,
                status=DeckAccessRequest.STATUS_APPROVED,
            ).update(
                status=DeckAccessRequest.STATUS_REVOKED,
                decided_by=by_user,
                decided_at=timezone.now(),
            )
        return removed

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
            "allow_download": self.allow_download,
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

class DeckCollaborator(models.Model):
    """A Knock-Knock user who can live-edit a Hanns deck."""
    PERMISSION_EDIT = "edit"
    PERMISSION_CHOICES = [
        (PERMISSION_EDIT, "Can edit"),
    ]

    # How they got in. This matters when the owner switches the review
    # link off: people who walked in through that link leave with it,
    # while people invited by email were let in personally and stay.
    SOURCE_INVITE = "invite"
    SOURCE_REVIEW_LINK = "review_link"
    SOURCE_CHOICES = [
        (SOURCE_INVITE, "Invited by email"),
        (SOURCE_REVIEW_LINK, "Asked from the review link"),
    ]

    deck = models.ForeignKey(
        Deck, on_delete=models.CASCADE, related_name="deck_collaborators",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name="hanns_collaborations",
    )
    permission = models.CharField(
        max_length=20, choices=PERMISSION_CHOICES, default=PERMISSION_EDIT,
    )
    source = models.CharField(
        max_length=16, choices=SOURCE_CHOICES, default=SOURCE_INVITE,
    )
    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="hanns_collaborators_invited",
    )
    accepted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("deck", "user")]
        ordering = ["user__email", "user__username"]

    def __str__(self):
        return f"{self.user} can edit {self.deck}"


class DeckInvite(models.Model):
    """Email invitation for a user who does not yet have a Knock-Knock account."""
    STATUS_PENDING = "pending"
    STATUS_ACCEPTED = "accepted"
    STATUS_REVOKED = "revoked"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_ACCEPTED, "Accepted"),
        (STATUS_REVOKED, "Revoked"),
    ]

    deck = models.ForeignKey(
        Deck, on_delete=models.CASCADE, related_name="deck_invites",
    )
    email = models.EmailField(db_index=True)
    token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    permission = models.CharField(
        max_length=20, choices=DeckCollaborator.PERMISSION_CHOICES,
        default=DeckCollaborator.PERMISSION_EDIT,
    )
    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="hanns_invites_sent",
    )
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=STATUS_PENDING)
    accepted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="hanns_invites_accepted",
    )
    accepted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("deck", "email", "status")]
        ordering = ["-created_at"]

    def __str__(self):
        return f"Invite {self.email} to {self.deck}"

    def accept(self, user):
        from django.utils import timezone

        collab, _ = DeckCollaborator.objects.update_or_create(
            deck=self.deck,
            user=user,
            defaults={
                "permission": self.permission,
                "invited_by": self.invited_by,
                "accepted_at": timezone.now(),
            },
        )
        self.status = self.STATUS_ACCEPTED
        self.accepted_by = user
        self.accepted_at = timezone.now()
        self.save(update_fields=["status", "accepted_by", "accepted_at"])
        return collab




class DeckReaction(models.Model):
    """One audience emoji reaction recorded during a Hanns presentation."""

    deck = models.ForeignKey(
        Deck, on_delete=models.CASCADE, related_name="deck_reactions",
    )
    emoji = models.CharField(max_length=16)
    slide_index = models.PositiveIntegerField(default=0)
    nick = models.CharField(max_length=80, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["deck", "emoji"]),
            models.Index(fields=["deck", "created_at"]),
        ]

    def __str__(self):
        return f"{self.emoji} on {self.deck} at slide {self.slide_index + 1}"


class DeckAccessRequest(models.Model):
    """A signed-in reviewer asking the owner for contributor (edit) rights.

    The mirror image of DeckInvite: there the owner reaches out, here the
    reviewer does. One row per (deck, user) — asking again after a decline
    reuses the row and flips it back to pending, so a deck never collects a
    pile of duplicate asks from the same person.
    """

    STATUS_PENDING = "pending"
    STATUS_APPROVED = "approved"
    STATUS_DECLINED = "declined"
    STATUS_REVOKED = "revoked"      # was approved, then taken back
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_APPROVED, "Approved"),
        (STATUS_DECLINED, "Declined"),
        (STATUS_REVOKED, "Revoked"),
    ]

    deck = models.ForeignKey(
        Deck, on_delete=models.CASCADE, related_name="access_requests",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name="hanns_access_requests",
    )
    message = models.CharField(max_length=500, blank=True)
    status = models.CharField(
        max_length=12, choices=STATUS_CHOICES,
        default=STATUS_PENDING, db_index=True,
    )
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="hanns_access_decisions",
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("deck", "user")]
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["deck", "status"]),
        ]

    def __str__(self):
        return f"{self.user} requested edit access to {self.deck}"

    @property
    def is_pending(self):
        return self.status == self.STATUS_PENDING

    def approve(self, by_user=None):
        """Grant edit rights. Idempotent — approving twice is harmless.

        Produces exactly the DeckCollaborator row an email invite would, so
        the dashboard query and _can_edit_deck need no special case.
        """
        collab, _ = DeckCollaborator.objects.update_or_create(
            deck=self.deck,
            user=self.user,
            defaults={
                "permission": DeckCollaborator.PERMISSION_EDIT,
                "source": DeckCollaborator.SOURCE_REVIEW_LINK,
                "invited_by": by_user or self.deck.owner,
                "accepted_at": timezone.now(),
            },
        )
        self.status = self.STATUS_APPROVED
        self.decided_by = by_user
        self.decided_at = timezone.now()
        self.save(update_fields=["status", "decided_by", "decided_at", "updated_at"])
        return collab

    def decline(self, by_user=None):
        """Turn the request down. The review link keeps working."""
        self.status = self.STATUS_DECLINED
        self.decided_by = by_user
        self.decided_at = timezone.now()
        self.save(update_fields=["status", "decided_by", "decided_at", "updated_at"])
        return self

    def revoke(self, by_user=None):
        """Take back edit rights that were granted earlier.

        Drops the DeckCollaborator row — that is what actually removes the
        deck from their dashboard and closes the editor to them.
        """
        DeckCollaborator.objects.filter(deck=self.deck, user=self.user).delete()
        self.status = self.STATUS_REVOKED
        self.decided_by = by_user
        self.decided_at = timezone.now()
        self.save(update_fields=["status", "decided_by", "decided_at", "updated_at"])
        return self

    def reopen(self, message=""):
        """Ask again after a decline — same row, back to pending."""
        self.status = self.STATUS_PENDING
        self.decided_by = None
        self.decided_at = None
        if message:
            self.message = message
        self.save(update_fields=[
            "status", "decided_by", "decided_at", "message", "updated_at",
        ])
        return self
