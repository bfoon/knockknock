import re
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
MAX_HISTORY_ITEMS = 4000      # total objects retained across the undo stacks
MAX_PAGES = 60

# Elements — text, photos, shapes, free shapes. Far fewer than strokes, but
# each one is heavier, and an image element carries a URL into media.
MAX_ELS_PER_PAGE = 400
MAX_TEXT = 2000               # characters in one text element
MAX_FF_POINTS = 240           # vertices in one free shape

# Photo uploads.
MAX_IMAGE_BYTES = 12 * 1024 * 1024
IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}

# Moving or resizing handwriting. One gesture carries one matrix and a list
# of stroke ids, so the cost is in the ids, not the ink.
MAX_XFORM_IDS = 1500

# A ready-made board arrives as one message and lands as one undo entry: a
# teacher who drops in a times-table grid and changes their mind wants one
# Undo, not forty. The biggest template in the library is under fifty.
MAX_TPL_ELS = 80

# Strokes in one paste. Copying a whole page of handwriting and dropping it
# on the next one is a reasonable thing to want; copying four thousand
# strokes in one message is not.
MAX_PASTE_STROKES = 1200


# ----------------------------------------------------------------------
# image addresses
# ----------------------------------------------------------------------
#
# An image src on a board must be something this server stored. An arbitrary
# absolute URL would make "add a photo" a fetch of anything, on the
# projector, in front of a class.
#
# This lives here rather than in consumers.py because the upload view needs
# the same answer: if the URL a fresh upload produces would not survive this
# check, the element is going to be refused the moment the phone sends it,
# and the teacher sees a photo that arrives and then silently is not there.
# Far better to fail the upload with a message someone can act on.

_SRC_PATH_RE = re.compile(r"^/[A-Za-z0-9._/~-]{1,300}$")
_SRC_ABS_RE = re.compile(r"^https?://[A-Za-z0-9.:-]{1,120}/[A-Za-z0-9._/~-]{1,300}$")


def board_image_src(image):
    """The address to store for an uploaded photo.

    Prefer the app's own route. A path under MEDIA_URL only works if
    something is actually serving MEDIA_ROOT, and when nothing is — the
    default in a fresh Django project, and in most ASGI deployments until
    somebody remembers — the photo uploads fine and then renders as an empty
    frame with no clue as to why. Serving it ourselves cannot be
    misconfigured.
    """
    from django.conf import settings
    from django.urls import reverse

    if getattr(settings, "CHALK_IMAGE_URLS", "app") == "media":
        direct = clean_src(image.file.url)
        if direct:
            return direct
    return reverse("chalk:image", args=[image.board_id, image.id])


def _is_own_image_url(path):
    """Is this path our own image route? Resolved, not pattern-matched, so it
    stays correct if the app is mounted somewhere other than /chalk/."""
    from django.urls import Resolver404, get_script_prefix, resolve

    prefix = get_script_prefix()
    if prefix != "/" and path.startswith(prefix):
        path = "/" + path[len(prefix):]
    try:
        return resolve(path).view_name == "chalk:image"
    except (Resolver404, Exception):
        return False


def clean_src(v):
    """Return `v` if it is an address under MEDIA_URL, else "".

    Handles both shapes MEDIA_URL comes in: a local path ("/media/") and an
    absolute origin ("https://files.example.com/media/"), which is what a
    storage backend on a CDN or a bucket gives you. A query string is kept
    when the whole thing is absolute — signed URLs carry their signature
    there — and refused on a local path, where it has no business.
    """
    from django.conf import settings

    v = str(v or "").strip()
    if not v or ".." in v or "\\" in v:
        return ""

    # Served by this app. Checked first, and without MEDIA_URL needing to be
    # set at all.
    if v.startswith("/") and _is_own_image_url(v.split("?")[0]):
        return v.split("?")[0]

    media = str(settings.MEDIA_URL or "")
    if not media:
        return ""
    if not v.startswith(media):
        return ""

    if media.startswith("/"):
        return v if _SRC_PATH_RE.match(v) else ""

    head, _, query = v.partition("?")
    if not _SRC_ABS_RE.match(head):
        return ""
    if query and not re.match(r"^[A-Za-z0-9._~%&=+/:-]{1,400}$", query):
        return ""
    return v


# ----------------------------------------------------------------------
# who drew what
# ----------------------------------------------------------------------
#
# Every stroke and every element carries a `by`: the id of the person who
# put it there. The board stores the id and nothing else, and the name,
# initials, colour and picture are looked up when they are needed — so
# somebody changing their photo changes it everywhere, and a page of
# handwriting does not carry a hundred copies of a name.

# Where to find a profile picture. Every project keeps it somewhere
# different, so this walks a few likely paths and gives up quietly. Point
# CHALK_AVATAR at the right one — "profile.photo", say — to skip the guessing.
AVATAR_PATHS = (
    "avatar", "photo", "image", "picture",
    "profile.avatar", "profile.photo", "profile.image", "profile.picture",
    "userprofile.avatar", "userprofile.photo",
    "member.avatar", "member.photo",
)


def _dig(obj, path):
    for attr in path.split("."):
        obj = getattr(obj, attr)
        if obj is None:
            return None
    return obj


def avatar_url(user):
    """Best-effort profile picture. Blank means initials will be used."""
    from django.conf import settings

    paths = list(AVATAR_PATHS)
    configured = getattr(settings, "CHALK_AVATAR", "")
    if configured:
        paths.insert(0, configured)
    for path in paths:
        try:
            found = _dig(user, path)
        except Exception:
            continue
        if not found:
            continue
        url = getattr(found, "url", None)
        if url:
            return str(url)
        if isinstance(found, str) and found.startswith(("/", "http")):
            return found
    getter = getattr(user, "get_avatar_url", None)
    if callable(getter):
        try:
            return str(getter() or "")
        except Exception:
            pass
    return ""


def person_name(user):
    full = (getattr(user, "get_full_name", None) and user.get_full_name() or "").strip()
    return full or getattr(user, "username", "") or getattr(user, "email", "") or "Someone"


def initials_of(name):
    bits = [b for b in str(name).replace(".", " ").split() if b]
    if not bits:
        return "?"
    if len(bits) == 1:
        return bits[0][:2].upper()
    return (bits[0][0] + bits[-1][0]).upper()


def person_card(user):
    """What the board needs to show for one person."""
    name = person_name(user)
    return {
        "id": str(user.id),
        "name": name[:60],
        "initials": initials_of(name),
        "avatar": avatar_url(user),
        # A stable hue per person, so the same colleague is the same colour
        # on every board and after every reload.
        "hue": (int(user.id) * 47) % 360,
    }


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
    # When on, anyone signed in to Knock-Knock who has the board number can
    # join and draw. Off by default: a board number read off a projector is
    # not a secret, and a class of thirty with the run of the board is
    # something a teacher should have to ask for.
    guests_allowed = models.BooleanField(default=False)
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

    Elements — text, photos, shapes, free shapes — live alongside the ink in
    `els`, above it in z-order:
        {"id": "e_ab12cd", "type": "shape", "x": .3, "y": .3, "w": .2,
         "h": .2, "rot": 0, ...type fields, "fx": {...}}

    Coordinates are normalised 0-1 against the board box, so the same page
    renders identically on a phone pad and a 4K projector.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    board = models.ForeignKey(Board, on_delete=models.CASCADE, related_name="pages")
    index = models.PositiveIntegerField(default=0)
    strokes = models.JSONField(default=list, blank=True)
    history = models.JSONField(default=list, blank=True)  # undo stack
    undone = models.JSONField(default=list, blank=True)  # redo stack
    els = models.JSONField(default=list, blank=True)
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


def board_image_path(instance, filename):
    import os

    ext = os.path.splitext(filename)[1].lower()[:8]
    if ext not in (".jpg", ".jpeg", ".png", ".gif", ".webp"):
        ext = ".jpg"
    return f"chalk/{instance.board_id}/{uuid.uuid4().hex}{ext}"


class BoardImage(models.Model):
    """Photos dropped onto a board.

    Tracked as rows rather than loose files so deleting a board takes its
    uploads with it, and so an upload can be attributed to a board before any
    element referencing it exists.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    board = models.ForeignKey(Board, on_delete=models.CASCADE, related_name="images")
    file = models.ImageField(upload_to=board_image_path)
    width = models.PositiveIntegerField(default=0)
    height = models.PositiveIntegerField(default=0)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-uploaded_at"]

    def __str__(self):
        return self.file.name

    def delete(self, *args, **kwargs):
        storage, name = self.file.storage, self.file.name
        super().delete(*args, **kwargs)
        if name:
            storage.delete(name)


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
