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

import hashlib
import random
import secrets
import string
import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone


def _gen_code(length=6):
    """Short, unambiguous join code (no 0/O/1/I) — same alphabet as Boardly."""
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(random.choice(alphabet) for _ in range(length))


def _gen_pin(length=6):
    """Presenter-controller PIN.

    secrets, not random: this one is a credential. Six digits rather than
    four, because the controller page is reachable by anyone who has the
    join code from the QR, so the PIN is the only thing standing between a
    curious guest and the Next button.
    """
    return "".join(secrets.choice(string.digits) for _ in range(length))


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

    # ── presenter controller ─────────────────────────────────────────
    # The PIN that unlocks the phone controller. Stored rather than derived
    # from the deck code, because a derived PIN can never be changed: the
    # moment it leaks, the only remedy would be a new deck. Blank means
    # "not generated yet" — ensure_control_pin() fills it in on first use,
    # so existing decks need no data migration.
    control_pin = models.CharField(max_length=8, blank=True)
    control_pin_rotated_at = models.DateTimeField(null=True, blank=True)

    def ensure_control_pin(self):
        """The current PIN, generating one the first time it is asked for."""
        if not self.control_pin:
            self.control_pin = _gen_pin()
            self.control_pin_rotated_at = timezone.now()
            self.save(update_fields=["control_pin", "control_pin_rotated_at"])
        return self.control_pin

    def rotate_control_pin(self):
        """Issue a new PIN. Every phone already holding the controller is
        dropped back to the lock screen — see control_fingerprint."""
        self.control_pin = _gen_pin()
        self.control_pin_rotated_at = timezone.now()
        self.save(update_fields=["control_pin", "control_pin_rotated_at"])
        return self.control_pin

    def control_fingerprint(self):
        """An opaque stamp of the current PIN.

        This is what an unlocked phone keeps in its session, never the PIN
        itself. Two things follow: a stolen session cookie yields no PIN,
        and rotating the PIN changes the stamp, so every phone that was
        already in is locked out on its next request.
        """
        raw = f"{self.pk}:{self.control_pin}".encode()
        return hashlib.sha256(raw).hexdigest()[:32]

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


# ═════════════════════════════════════════════════════════════════════
# Big Screen — a room display that many presenters can share decks to
# ═════════════════════════════════════════════════════════════════════
#
# The host opens one tokenised link on the projector, goes full screen and
# never has to leave it. Presenters type the screen's six-digit SHARE CODE
# into Hanns to drop their deck into the screen's queue; the host pulls the
# queue down from a small arrow at the top of the screen and picks what
# plays next.
#
# Three separate secrets, on purpose:
#
#   token         the screen URL itself. Long and unguessable, because
#                 whoever holds it can run the room. It lives only in the
#                 projector's address bar (hidden in full screen) and on the
#                 host's own dashboard.
#   share_code    six digits the host reads out or texts to presenters. It
#                 can only ADD a deck to the queue — never put one on air —
#                 so a leaked code costs the host one "remove" tap.
#   control_code  six digits per shared deck, issued by the host to a
#                 presenter who has no laptop in the room. It unlocks the
#                 phone controller for THAT deck only, for as long as the
#                 share is open, and dies the moment it is removed or the
#                 screen is stopped. It is never the deck owner's own PIN.


def _gen_digits(length=6):
    """Six digits from a CSPRNG — these are credentials, not labels."""
    return "".join(secrets.choice(string.digits) for _ in range(length))


def _gen_screen_token():
    return secrets.token_urlsafe(24)


class BigScreen(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name="hanns_screens",
    )
    name = models.CharField(max_length=80, default="Big screen")
    token = models.CharField(max_length=64, unique=True, db_index=True, editable=False)
    share_code = models.CharField(max_length=8, db_index=True, editable=False)
    is_active = models.BooleanField(default=True, db_index=True)

    # The lobby shows the share code in large type so the room can see how
    # to join. A host who would rather hand the code out privately turns
    # this off and the lobby shows only the screen name.
    show_code_on_screen = models.BooleanField(default=True)

    current_share = models.ForeignKey(
        "ScreenShare", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="+",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-is_active", "-created_at"]

    def __str__(self):
        return f"{self.name} ({'live' if self.is_active else 'stopped'})"

    @staticmethod
    def _free_share_code():
        # Unique among ACTIVE screens only — a stopped screen's old code can
        # be handed out again without anyone being able to reach it.
        for _ in range(40):
            code = _gen_digits()
            if not BigScreen.objects.filter(is_active=True, share_code=code).exists():
                return code
        raise RuntimeError("Could not allocate a free screen share code.")

    def save(self, *args, **kwargs):
        if not self.token:
            self.token = _gen_screen_token()
        if not self.share_code:
            self.share_code = self._free_share_code()
        super().save(*args, **kwargs)

    def rotate_share_code(self):
        """New share code. Decks already in the queue stay in the queue."""
        self.share_code = self._free_share_code()
        self.save(update_fields=["share_code"])
        return self.share_code

    def open_shares(self):
        return self.shares.filter(status__in=ScreenShare.OPEN_STATES).select_related(
            "deck", "shared_by",
        )

    def stop(self):
        """End the screen. Every open share closes and every control code
        dies with it. Returns the ids of the shares that were closed so the
        caller can drop their phone controllers."""
        now = timezone.now()
        closing = list(self.shares.filter(status__in=ScreenShare.OPEN_STATES))
        ids = [s.id for s in closing]
        ScreenShare.objects.filter(id__in=ids).update(
            status=ScreenShare.STATUS_ENDED, closed_at=now,
            control_code="", control_code_at=None,
        )
        self.is_active = False
        self.ended_at = now
        self.current_share = None
        self.save(update_fields=["is_active", "ended_at", "current_share"])
        return closing


class ScreenShare(models.Model):
    """One deck sitting in a big screen's queue."""

    STATUS_WAITING = "waiting"      # shared, the host has not played it yet
    STATUS_LIVE = "live"            # on the big screen right now
    STATUS_SHOWN = "shown"          # was on screen; still in the list
    STATUS_REMOVED = "removed"      # host took it out
    STATUS_WITHDRAWN = "withdrawn"  # the presenter took it back
    STATUS_ENDED = "ended"          # the screen was stopped
    STATUS_CHOICES = [
        (STATUS_WAITING, "Waiting"),
        (STATUS_LIVE, "On screen"),
        (STATUS_SHOWN, "Shown"),
        (STATUS_REMOVED, "Removed by host"),
        (STATUS_WITHDRAWN, "Withdrawn"),
        (STATUS_ENDED, "Screen stopped"),
    ]
    OPEN_STATES = (STATUS_WAITING, STATUS_LIVE, STATUS_SHOWN)

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    screen = models.ForeignKey(BigScreen, on_delete=models.CASCADE, related_name="shares")
    deck = models.ForeignKey(Deck, on_delete=models.CASCADE, related_name="screen_shares")
    shared_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="hanns_screen_shares",
    )
    # Snapshot, so the queue still says who shared it if the account is
    # renamed or deleted mid-event.
    sharer_name = models.CharField(max_length=120, blank=True)
    note = models.CharField(max_length=140, blank=True)
    status = models.CharField(
        max_length=12, choices=STATUS_CHOICES, default=STATUS_WAITING, db_index=True,
    )

    control_code = models.CharField(max_length=8, blank=True, db_index=True)
    control_code_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    went_live_at = models.DateTimeField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [models.Index(fields=["screen", "status"])]

    def __str__(self):
        return f"{self.deck} → {self.screen} [{self.status}]"

    @property
    def is_open(self):
        return self.status in self.OPEN_STATES

    def issue_control_code(self):
        """A fresh six-digit code, unique among open shares. Issuing a new
        one invalidates the old one — the caller drops phones holding it."""
        for _ in range(40):
            code = _gen_digits()
            if not ScreenShare.objects.filter(
                control_code=code, status__in=self.OPEN_STATES,
            ).exclude(pk=self.pk).exists():
                break
        else:
            raise RuntimeError("Could not allocate a free control code.")
        self.control_code = code
        self.control_code_at = timezone.now()
        self.save(update_fields=["control_code", "control_code_at"])
        return code

    def control_fingerprint(self):
        """What an unlocked phone keeps in its session — never the code."""
        raw = f"screen:{self.pk}:{self.control_code}".encode()
        return hashlib.sha256(raw).hexdigest()[:32]
