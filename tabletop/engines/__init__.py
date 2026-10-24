"""Rules engines, keyed by the game key stored on a Match."""

from . import chess, draughts, ludo, words
from .base import Illegal  # noqa: F401

ENGINES = {
    "chess": chess,
    "dam": draughts,
    "ludo": ludo,
    "words": words,
}

GAME_CHOICES = [(k, m.META["label"]) for k, m in ENGINES.items()]


def engine(key):
    return ENGINES[key]
