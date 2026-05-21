"""
boardly/models.py — data model for the Boardly sticky board.

Three tables: a BoardSession (one live board), optional BoardGroups
(topic columns), and Notes. Mirrors the shape of your existing poll
session so it can share the same dashboard / session-code machinery.
"""

import random
import string

from django.conf import settings
from django.db import models


def _gen_code(length=6):
    """Short, unambiguous join code (no 0/O/1/I)."""
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(random.choice(alphabet) for _ in range(length))


class BoardSession(models.Model):
    STATE_CHOICES = [
        ("lobby", "Lobby"),       # created, not yet open
        ("open", "Open"),         # accepting notes
        ("running", "Running"),   # alias of open (kept for protocol parity)
        ("ended", "Ended"),       # closed
    ]
    MODE_CHOICES = [
        ("open", "Open — anyone can post anytime"),
        ("moderated", "Moderated — presenter curates"),
    ]
    LAYOUT_CHOICES = [
        ("grid", "Neat grid"),
        ("masonry", "Masonry columns"),
        ("scatter", "Scattered sticky"),
    ]

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name="board_sessions", null=True, blank=True,
    )
    code = models.CharField(max_length=12, unique=True, db_index=True)
    title = models.CharField(max_length=140, default="Idea Board")
    prompt = models.CharField(
        max_length=200, default="Share your idea",
        help_text="The question or prompt shown to participants.",
    )
    state = models.CharField(max_length=12, choices=STATE_CHOICES, default="lobby")
    mode = models.CharField(max_length=12, choices=MODE_CHOICES, default="open")
    layout = models.CharField(max_length=10, choices=LAYOUT_CHOICES, default="grid")

    allow_likes = models.BooleanField(default=True)
    participant_count = models.IntegerField(default=0)

    # Max notes a single participant may post. 0 = unlimited. Set at
    # creation and editable live from the presenter stage; the consumer
    # enforces it per author in _handle_note.
    per_participant_limit = models.PositiveSmallIntegerField(default=0)

    # When True, sticky notes can't be dragged from one topic column to
    # another. Notes stay movable by default; the owner sets this at
    # board creation and can also flip it live from the presenter stage.
    # Only affects cross-column moves — it never locks a board that has
    # no columns at all.
    lock_columns = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.title} ({self.code})"

    def save(self, *args, **kwargs):
        if not self.code:
            code = _gen_code()
            while BoardSession.objects.filter(code=code).exists():
                code = _gen_code()
            self.code = code
        super().save(*args, **kwargs)

    @property
    def is_open(self):
        return self.state in ("open", "running")


class BoardGroup(models.Model):
    """An optional topic column. A board with zero groups renders flat."""
    session = models.ForeignKey(
        BoardSession, on_delete=models.CASCADE, related_name="groups",
    )
    name = models.CharField(max_length=60)
    position = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["position", "id"]

    def __str__(self):
        return self.name


class Note(models.Model):
    """A single sticky note posted by a participant."""
    session = models.ForeignKey(
        BoardSession, on_delete=models.CASCADE, related_name="notes",
    )
    group = models.ForeignKey(
        BoardGroup, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="notes",
    )
    text = models.CharField(max_length=180)
    color = models.PositiveSmallIntegerField(default=0)   # 0..5
    icon = models.CharField(max_length=20, default="none")
    author = models.CharField(max_length=40, default="Anonymous")

    likes = models.PositiveIntegerField(default=0)
    hidden = models.BooleanField(default=False)
    pinned = models.BooleanField(default=False)

    # Edit tracking. The Note row always holds the *current* values; the
    # full before/after of every change is preserved in NoteEdit rows so
    # nothing originally recorded is ever lost. ``edited_at`` is the time
    # of the most recent edit (NULL = never edited).
    edited_at = models.DateTimeField(null=True, blank=True)

    # Free position on the board, set when the presenter drags a note.
    # Stored as fractions (0.0–1.0) of the board sheet's width/height so
    # the layout survives different projector resolutions. NULL means the
    # note has never been dragged and should follow the automatic layout.
    pos_x = models.FloatField(null=True, blank=True)
    pos_y = models.FloatField(null=True, blank=True)

    created_at = models.DateTimeField()

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return f"{self.author}: {self.text[:30]}"

    def as_dict(self):
        """Serialised form used in every WebSocket payload."""
        return {
            "id": self.id,
            "text": self.text,
            "color": self.color,
            "icon": self.icon,
            "author": self.author,
            "likes": self.likes,
            "hidden": self.hidden,
            "pinned": self.pinned,
            "group_id": self.group_id,
            # null until the presenter drags the note; the client falls
            # back to automatic layout when these are null.
            "pos_x": self.pos_x,
            "pos_y": self.pos_y,
            # True once the note has been edited at least once; lets the
            # client show an "(edited)" marker. The actual history lives
            # in NoteEdit rows.
            "edited": self.edited_at is not None,
        }


class NoteEdit(models.Model):
    """
    One row per edit of a Note — an append-only history.

    Editing a note never destroys what was recorded: the Note row holds
    the current values, and every change (by presenter or author) writes
    a NoteEdit snapshot of the field values *before* and *after*. This is
    what makes editing "not change the data recorded" — the original is
    always recoverable.
    """
    EDITOR_CHOICES = [
        ("presenter", "Presenter"),
        ("author", "Author"),
    ]

    note = models.ForeignKey(
        Note, on_delete=models.CASCADE, related_name="edits",
    )
    edited_by = models.CharField(
        max_length=12, choices=EDITOR_CHOICES, default="presenter",
    )
    # Who made the change, as a display name (presenter label or nick).
    editor_name = models.CharField(max_length=40, default="")

    # Snapshot of the four editable fields, before and after this edit.
    old_text = models.CharField(max_length=180, blank=True)
    new_text = models.CharField(max_length=180, blank=True)
    old_color = models.PositiveSmallIntegerField(default=0)
    new_color = models.PositiveSmallIntegerField(default=0)
    old_icon = models.CharField(max_length=20, default="none")
    new_icon = models.CharField(max_length=20, default="none")
    old_group_id = models.IntegerField(null=True, blank=True)
    new_group_id = models.IntegerField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return f"edit of note {self.note_id} at {self.created_at:%Y-%m-%d %H:%M}"
