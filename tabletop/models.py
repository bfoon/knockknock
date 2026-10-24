"""Live Tables — board-game nights on the big screen, played from phones.

A GameNight is one room: the host projects the stage (leaderboard plus a
featured 3D board), players join from their phones with a code, and the
host deals them into tables of Chess, Dam, Ludo or Scramble. Every table is
a Match whose full rules state lives in `state` (see tabletop/engines).

Points carry across rounds, so a night can be several games long and the
leaderboard on the projector keeps the room competitive:

    win 3 · draw 1 · loss 0            (2-seat games)
    1st 3 · 2nd 2 · 3rd 1 · 4th 0      (Ludo / Scramble)
"""

import secrets
import uuid

from django.conf import settings
from django.db import IntegrityError, models, transaction

from .engines import GAME_CHOICES

CODE_LENGTH = 6
MAX_PLAYERS = 80


def _new_code():
    return "".join(secrets.choice("0123456789") for _ in range(CODE_LENGTH))


class GameNight(models.Model):
    STATE_CHOICES = [("lobby", "Lobby"), ("playing", "Playing"), ("ended", "Ended")]
    VIEW_CHOICES = [("split", "Board + leaderboard"), ("board", "Board"),
                    ("leaderboard", "Leaderboard"), ("tables", "All tables")]
    PAIRING_CHOICES = [("random", "Random"), ("ranked", "By leaderboard")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                              related_name="game_nights")
    title = models.CharField(max_length=120, default="Game Night")
    code = models.CharField(max_length=10, unique=True, db_index=True)
    game = models.CharField(max_length=12, choices=GAME_CHOICES, default="chess")
    state = models.CharField(max_length=10, choices=STATE_CHOICES, default="lobby")
    view = models.CharField(max_length=12, choices=VIEW_CHOICES, default="split")
    pairing = models.CharField(max_length=10, choices=PAIRING_CHOICES, default="random")
    check_words = models.BooleanField(default=True)
    dam_size = models.PositiveSmallIntegerField(default=10)
    round = models.PositiveIntegerField(default=0)
    featured = models.ForeignKey("Match", null=True, blank=True, on_delete=models.SET_NULL,
                                 related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.title} ({self.code})"

    @property
    def pretty_code(self):
        return f"{self.code[:3]} {self.code[3:]}"

    def save(self, *args, **kwargs):
        if self.code:
            return super().save(*args, **kwargs)
        for _ in range(20):
            self.code = _new_code()
            try:
                with transaction.atomic():
                    return super().save(*args, **kwargs)
            except IntegrityError:
                self.code = ""
        raise IntegrityError("Could not allocate a game-night code")


class Player(models.Model):
    night = models.ForeignKey(GameNight, on_delete=models.CASCADE, related_name="players")
    name = models.CharField(max_length=40)
    avatar_id = models.CharField(max_length=40, default="dragon")
    token = models.CharField(max_length=48, unique=True, db_index=True)
    points = models.IntegerField(default=0)
    wins = models.PositiveIntegerField(default=0)
    draws = models.PositiveIntegerField(default=0)
    losses = models.PositiveIntegerField(default=0)
    played = models.PositiveIntegerField(default=0)
    kills = models.PositiveIntegerField(default=0)   # pieces cut down, all games
    online = models.SmallIntegerField(default=0)     # open sockets (best effort)
    benched = models.BooleanField(default=False)     # sits out the next deal
    kicked = models.BooleanField(default=False)
    joined_at = models.DateTimeField(auto_now_add=True)
    last_seen = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-points", "-wins", "joined_at"]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if not self.token:
            self.token = secrets.token_urlsafe(24)
        return super().save(*args, **kwargs)


class Match(models.Model):
    STATUS_CHOICES = [("active", "Active"), ("done", "Done"), ("void", "Void")]

    night = models.ForeignKey(GameNight, on_delete=models.CASCADE, related_name="matches")
    round = models.PositiveIntegerField(default=1)
    table = models.PositiveSmallIntegerField(default=1)
    game = models.CharField(max_length=12, choices=GAME_CHOICES)
    seats = models.JSONField(default=list)        # [player_id, ...] in seat order
    state = models.JSONField(default=dict)        # engine state (authoritative)
    status = models.CharField(max_length=8, choices=STATUS_CHOICES, default="active")
    version = models.PositiveIntegerField(default=0)
    awarded = models.JSONField(default=dict)      # {player_id: points} once done
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["round", "table"]
        indexes = [models.Index(fields=["night", "status"])]

    def __str__(self):
        return f"{self.night.code} r{self.round} t{self.table} {self.game}"
