"""Rules engines, keyed by the game key stored on a Match."""

from . import chess, draughts, four, ludo, oware, quest, snakes, words
from .base import Illegal  # noqa: F401

ENGINES = {
    "chess": chess,
    "dam": draughts,
    "ludo": ludo,
    "words": words,
    "oware": oware,
    "snakes": snakes,
    "four": four,
    "quest": quest,
}

GAME_CHOICES = [(k, m.META["label"]) for k, m in ENGINES.items()]


def engine(key):
    return ENGINES[key]
