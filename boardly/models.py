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


class BoardFlow(models.Model):
    """
    A linked multi-page Boardly project.

    Think of this like a PDF/deck: each BoardSession is one page/module,
    and the flow keeps them together so the presenter can click Previous
    and Next through Explore → Create → Evaluate, etc.
    """
    TEMPLATE_CHOICES = [
        ("innovation", "Innovation"),
        ("ideation", "Ideation"),
        ("logistics", "Logistics"),
        ("business", "Business"),
        ("value_chain", "Value Chain"),
        ("custom", "Custom"),
    ]

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="board_flows",
        null=True,
        blank=True,
    )
    name = models.CharField(max_length=140, default="Board Project")
    template_key = models.CharField(
        max_length=40, choices=TEMPLATE_CHOICES, default="custom",
    )
    description = models.CharField(max_length=240, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.name


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
    background_image = models.ImageField(
        upload_to="boardly/backgrounds/", null=True, blank=True,
        help_text="Optional photo/background used behind the board sheet.",
    )

    # Multi-page / PDF-style flow support. A session can still stand alone;
    # when linked to BoardFlow, it becomes one page/module in that project.
    flow = models.ForeignKey(
        BoardFlow,
        on_delete=models.CASCADE,
        related_name="pages",
        null=True,
        blank=True,
    )
    template_key = models.CharField(max_length=40, blank=True, default="custom")
    module_key = models.CharField(max_length=40, blank=True, default="")
    module_label = models.CharField(max_length=80, blank=True, default="")
    module_order = models.PositiveSmallIntegerField(default=0)
    module_description = models.CharField(max_length=240, blank=True, default="")

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
        ordering = ["module_order", "-created_at", "id"]

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

    @property
    def page_label(self):
        return self.module_label or self.title


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
            # Freehand / highlighter strokes drawn ON this note. Each is a
            # dict {id, tool, points:[[x,y],…]} with x,y as 0.0–1.0
            # fractions of the note's own width/height, so the marks ride
            # with the pad wherever it moves and survive any projector
            # resolution. Empty list when the note has never been drawn on.
            # Prefetch ``drawings`` upstream to avoid an N+1 here.
            "drawings": [d.as_dict() for d in self.drawings.all()],
        }


class NoteDrawing(models.Model):
    """
    One freehand / highlighter stroke drawn ON a sticky note.

    Strokes belong to a Note and are stored in the note's OWN coordinate
    space — every point is a (x, y) pair of 0.0–1.0 fractions of the
    note's width/height. Because the coordinates are note-local rather
    than board-pixel, a stroke automatically rides with its pad when the
    presenter drags it, when the layout changes (grid / masonry / scatter
    / free / columns), and across different projector resolutions. The
    rows persist, so the marks survive a refresh or rejoining the board;
    they only disappear when erased (this row is deleted) or when the
    parent note is removed (cascade).

    ``points`` is a JSON list of [x, y] pairs, e.g.
        [[0.12, 0.20], [0.18, 0.24], …]
    kept compact so a stroke is one small row.
    """
    TOOL_CHOICES = [
        ("highlighter", "Highlighter"),
        ("pen", "Pen"),
    ]

    note = models.ForeignKey(
        Note, on_delete=models.CASCADE, related_name="drawings",
    )
    tool = models.CharField(
        max_length=12, choices=TOOL_CHOICES, default="pen",
    )
    # List of [x, y] fractional points (0.0–1.0) in the note's local box.
    points = models.JSONField(default=list)
    # Who drew it, for parity with NoteEdit. Presenter-drawn for now.
    drawn_by = models.CharField(max_length=40, default="Presenter")

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]

    def __str__(self):
        return f"{self.tool} stroke on note {self.note_id}"

    def as_dict(self):
        """Serialised form sent in WebSocket payloads."""
        return {
            "id": self.id,
            "tool": self.tool,
            # Emit as plain [x, y] pairs — the client repaints from these.
            "points": self.points or [],
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
