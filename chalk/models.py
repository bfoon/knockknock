import secrets
import uuid
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, models, transaction
from django.utils import timezone

SURFACES = [
    ("black", "Blackboard"),
    ("green", "Green chalkboard"),
    ("white", "Whiteboard"),
    ("grid", "Grid paper"),
    ("ruled", "Ruled paper"),
]

# Digits only, so it can be read off a projector and typed on a phone keypad.
# Eight digits is 100x the search space of six and still reads as two blocks
# of four. Existing six-digit rows keep working; the routing regex accepts
# either length.
CODE_LENGTH = 8
CODE_ALPHABET = "0123456789"

# A pairing is not immortal. It stays alive as long as somebody is connected
# (the consumer extends it), and dies quietly some hours after the lesson.
SESSION_TTL = timedelta(hours=8)

# Failed /join/ attempts against one code before that code auto-rotates.
MAX_FAILED_JOINS = 10

# Shared limits — consumers.py imports these so there is one source of truth.
MAX_POINTS = 12000            # values (not points) per committed stroke
MAX_STROKES_PER_PAGE = 4000
MAX_UNDO = 60
MAX_HISTORY_ITEMS = 4000      # total strokes retained across the undo stacks
MAX_PAGES = 60


def make_code():
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))


def make_token():
    return secrets.token_urlsafe(24)


def _free_code(exclude_pk=None):
    """A code no live session is using. Raises if the space is somehow full."""
    for _ in range(30):
        code = make_code()
        qs = BoardSession.objects.filter(code=code)
        if exclude_pk is not None:
            qs = qs.exclude(pk=exclude_pk)
        if not qs.exists():
            return code
    raise RuntimeError("Could not allocate a free board code")


class Board(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="chalk_boards",
    )
    title = models.CharField(max_length=200, default="Untitled board")
    surface = models.CharField(max_length=16, choices=SURFACES, default="black")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return self.title

    # -- session -------------------------------------------------------

    def ensure_session(self):
        """Get or create this board's pairing session, race-safely.

        `session` is a OneToOne, so two concurrent stage loads on a fresh
        board used to collide on create. Catch the IntegrityError and re-read
        rather than letting one of the two requests 500.
        """
        try:
            return self.session
        except BoardSession.DoesNotExist:
            pass
        try:
            with transaction.atomic():
                return BoardSession.objects.create(board=self, code=_free_code())
        except IntegrityError:
            existing = BoardSession.objects.filter(board=self).first()
            if existing:
                return existing
            raise

    # -- pages ---------------------------------------------------------

    def ensure_page(self, index=0):
        try:
            with transaction.atomic():
                page, _ = BoardPage.objects.get_or_create(board=self, index=index)
                return page
        except IntegrityError:
            return BoardPage.objects.get(board=self, index=index)

    def renumber_pages(self):
        """Force page indices to be dense: 0, 1, 2, ... with no gaps.

        Deleting a page used to leave a hole, and the phone navigates by
        `index + 1`, so a hole meant `get_or_create` silently resurrected the
        page you had just deleted. Two passes, because the (board, index)
        unique constraint will not tolerate a transient collision.
        """
        pages = list(self.pages.order_by("index").only("pk", "index"))
        parked = MAX_PAGES + 1000
        for offset, page in enumerate(pages):
            if page.index != offset:
                BoardPage.objects.filter(pk=page.pk).update(index=parked + offset)
        for offset, page in enumerate(pages):
            BoardPage.objects.filter(pk=page.pk).update(index=offset)
        return len(pages)

    @property
    def page_count(self):
        """Prefer the annotated `pages_total` when the queryset supplied one.

        BoardListView annotates, so the list view is a single query instead of
        one COUNT per board.
        """
        annotated = getattr(self, "pages_total", None)
        if annotated is not None:
            return max(1, annotated)
        return max(1, self.pages.count())

    def touch(self):
        """Bump updated_at without a full save or an auto_now round-trip.

        Every mutating path calls this, not just stroke commits, so a board
        that was only erased or repaginated does not sink down the list.
        """
        Board.objects.filter(pk=self.pk).update(updated_at=timezone.now())


class BoardPage(models.Model):
    """One board surface. Ink is stored as a list of vector strokes.

    A stroke is:
        {"id": "s_ab12cd", "tool": "pen", "color": "#ffffff",
         "w": 0.0035, "pts": [x, y, x, y, ...]}

    Coordinates are normalised 0-1 against the board box, so the same page
    renders identically on a phone pad and a 4K projector.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    board = models.ForeignKey(Board, on_delete=models.CASCADE, related_name="pages")
    index = models.PositiveIntegerField(default=0)
    strokes = models.JSONField(default=list, blank=True)
    history = models.JSONField(default=list, blank=True)  # undo stack
    undone = models.JSONField(default=list, blank=True)  # redo stack
    els = models.JSONField(default=list, blank=True)  # reserved for Pass 2
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["index"]
        constraints = [
            models.UniqueConstraint(
                fields=["board", "index"], name="chalk_page_unique_index"
            )
        ]

    def __str__(self):
        return f"{self.board.title} · page {self.index + 1}"


class BoardSession(models.Model):
    """The pairing between a projector and one phone.

    `code` is what the teacher types or scans. Rotating it issues a new token
    AND bumps `revision`; the consumer watches `revision`, so a phone that is
    already connected gets evicted rather than quietly carrying on writing.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    board = models.OneToOneField(
        Board, on_delete=models.CASCADE, related_name="session"
    )
    code = models.CharField(max_length=12, unique=True, db_index=True)
    token = models.CharField(max_length=64, default=make_token)
    revision = models.PositiveIntegerField(default=0)
    page_index = models.PositiveIntegerField(default=0)
    expires_at = models.DateTimeField(default=timezone.now)
    failed_joins = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    rotated_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.board.title} · {self.pretty_code}"

    def save(self, *args, **kwargs):
        if not self.code:
            self.code = _free_code(exclude_pk=self.pk)
        if self._state.adding:
            self.expires_at = timezone.now() + SESSION_TTL
        return super().save(*args, **kwargs)

    @property
    def pretty_code(self):
        half = len(self.code) // 2
        return f"{self.code[:half]} {self.code[half:]}"

    @property
    def is_live(self):
        return self.expires_at > timezone.now()

    def extend(self):
        """Push the expiry out. Called while somebody is actually connected."""
        fresh = timezone.now() + SESSION_TTL
        # Only write when it moves the needle by more than a minute, so an
        # active lesson is not one UPDATE per heartbeat.
        if (fresh - self.expires_at).total_seconds() > 60:
            self.expires_at = fresh
            BoardSession.objects.filter(pk=self.pk).update(expires_at=fresh)
        return self

    @transaction.atomic
    def rotate(self):
        """New code, new token, new revision. Any live phone is invalidated.

        The caller is responsible for broadcasting the eviction to the old
        room — see views.RotateCodeView.
        """
        self.code = _free_code(exclude_pk=self.pk)
        self.token = make_token()
        self.revision = self.revision + 1
        self.failed_joins = 0
        self.rotated_at = timezone.now()
        self.expires_at = timezone.now() + SESSION_TTL
        self.save(
            update_fields=[
                "code",
                "token",
                "revision",
                "failed_joins",
                "rotated_at",
                "expires_at",
            ]
        )
        return self

    def note_failed_join(self):
        """Count a wrong-code guess against this session.

        Enough of them and the code rotates itself out from under the
        attacker. Combined with the per-IP throttle in views.JoinView this
        makes enumerating the code space impractical.
        """
        updated = BoardSession.objects.filter(pk=self.pk)
        updated.update(failed_joins=models.F("failed_joins") + 1)
        self.refresh_from_db(fields=["failed_joins"])
        if self.failed_joins >= MAX_FAILED_JOINS:
            self.rotate()
            return True
        return False
