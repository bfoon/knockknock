import secrets
import uuid

from django.conf import settings
from django.db import models, transaction

SURFACES = [
    ("black", "Blackboard"),
    ("green", "Green chalkboard"),
    ("white", "Whiteboard"),
    ("grid", "Grid paper"),
    ("ruled", "Ruled paper"),
]

# Digits only, so it can be read off a projector and typed on a phone keypad.
CODE_LENGTH = 6
CODE_ALPHABET = "0123456789"


def make_code():
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))


def make_token():
    return secrets.token_urlsafe(24)


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

    def ensure_session(self):
        session = BoardSession.objects.filter(board=self).first()
        if session:
            return session
        for _ in range(20):
            code = make_code()
            if not BoardSession.objects.filter(code=code).exists():
                return BoardSession.objects.create(board=self, code=code)
        raise RuntimeError("Could not allocate a free board code")

    def ensure_page(self, index=0):
        page, _ = BoardPage.objects.get_or_create(board=self, index=index)
        return page

    @property
    def page_count(self):
        return max(1, self.pages.count())


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

    `code` is what the teacher types or scans. Rotating it issues a new token,
    which silently kicks any phone still holding the old one.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    board = models.OneToOneField(
        Board, on_delete=models.CASCADE, related_name="session"
    )
    code = models.CharField(max_length=CODE_LENGTH, unique=True, db_index=True)
    token = models.CharField(max_length=64, default=make_token)
    page_index = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    rotated_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.board.title} · {self.pretty_code}"

    @property
    def pretty_code(self):
        return f"{self.code[:3]} {self.code[3:]}"

    @transaction.atomic
    def rotate(self):
        from django.utils import timezone

        for _ in range(20):
            code = make_code()
            if code == self.code:
                continue
            if BoardSession.objects.filter(code=code).exclude(pk=self.pk).exists():
                continue
            self.code = code
            self.token = make_token()
            self.rotated_at = timezone.now()
            self.save(update_fields=["code", "token", "rotated_at"])
            return self
        raise RuntimeError("Could not allocate a free board code")
