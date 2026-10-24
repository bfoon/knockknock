"""Scramble — a crossword tile game for 2-4 players.

15x15 board, 100 tiles (two blanks), racks of seven, premium squares.
Words are checked against the public-domain ENABLE list (168k words)
unless the host turns checking off ("house rules" — the room decides).

Actions:
    {"type": "play", "tiles": [{"r": 7, "c": 7, "l": "A"},
                               {"r": 7, "c": 8, "l": "x", "blank": true}]}
    {"type": "swap", "letters": ["Q", "?"]}     (needs 7+ tiles in the bag)
    {"type": "pass"}

A blank is "?" in the rack; on the board it is stored lower-case and
scores zero. Using all seven tiles in one play earns +50.

The game ends when the bag is empty and someone plays out their rack, or
after every player has passed / scored nothing twice in a row. Each player
then loses the value of the tiles left on their rack; whoever went out
gains the total.
"""

import gzip
import os
from functools import lru_cache

from .base import Illegal, finish, resign

META = {"key": "words", "label": "Scramble", "emoji": "🔤", "min": 2, "max": 4}
N = 15
CENTER = (7, 7)
RACK = 7
BINGO = 50

DIST = ("A9 B2 C2 D4 E12 F2 G3 H2 I9 J1 K1 L4 M2 N6 O8 P2 Q1 R6 S4 T6 U4 V2 "
        "W2 X1 Y2 Z1 ?2")
VALUES = dict(A=1, B=3, C=3, D=2, E=1, F=4, G=2, H=4, I=1, J=8, K=5, L=1, M=3,
              N=1, O=1, P=3, Q=10, R=1, S=1, T=1, U=1, V=4, W=4, X=8, Y=4, Z=10)
VALUES["?"] = 0

# Premium squares, defined on one quarter and mirrored 8 ways.
_QUARTER = {
    "TW": [(0, 0), (0, 7)],
    "DW": [(1, 1), (2, 2), (3, 3), (4, 4), (7, 7)],
    "TL": [(1, 5), (5, 5)],
    "DL": [(0, 3), (2, 6), (3, 7), (6, 6)],
}


def _premiums():
    grid = [""] * (N * N)
    for kind, cells in _QUARTER.items():
        for r, c in cells:
            for rr, cc in ((r, c), (c, r)):
                for R, C in ((rr, cc), (rr, N - 1 - cc), (N - 1 - rr, cc), (N - 1 - rr, N - 1 - cc)):
                    grid[R * N + C] = kind
    return grid


PREMIUM = _premiums()


@lru_cache(maxsize=1)
def dictionary():
    path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "enable1.txt.gz")
    with gzip.open(path, "rt", encoding="ascii") as fh:
        return frozenset(w.strip().upper() for w in fh if w.strip())


def is_word(w):
    return w.upper() in dictionary()


def _bag(rng):
    bag = []
    for chunk in DIST.split():
        bag.extend(chunk[0] * int(chunk[1:]))
    rng.shuffle(bag)
    return bag


def new_game(n=2, rng=None, check_words=True):
    n = max(2, min(4, n))
    bag = _bag(rng)
    racks = [[bag.pop() for _ in range(RACK)] for _ in range(n)]
    return {
        "seats": n, "board": [""] * (N * N), "bag": bag, "racks": racks,
        "scores": [0] * n, "turn": 0, "over": False, "result": None,
        "moves": 0, "scoreless": 0, "last": None, "log": [],
        "check": bool(check_words), "first": True,
    }


def _at(board, r, c):
    if 0 <= r < N and 0 <= c < N:
        return board[r * N + c]
    return None


def _word_through(board, r, c, dr, dc):
    """Return [(r, c), ...] for the maximal word through (r, c) along a direction."""
    while _at(board, r - dr, c - dc):
        r, c = r - dr, c - dc
    cells = []
    while _at(board, r, c):
        cells.append((r, c))
        r, c = r + dr, c + dc
    return cells


def _score_word(board, cells, new):
    total, mult = 0, 1
    for r, c in cells:
        ch = board[r * N + c]
        v = 0 if ch.islower() else VALUES[ch]
        if (r, c) in new:
            p = PREMIUM[r * N + c]
            if p == "DL":
                v *= 2
            elif p == "TL":
                v *= 3
            elif p == "DW":
                mult *= 2
            elif p == "TW":
                mult *= 3
        total += v
    return total * mult


def evaluate(st, seat, tiles):
    """Validate a play. Returns (words, score, used_rack_letters, board)."""
    if not tiles or len(tiles) > RACK:
        raise Illegal("Place between one and seven tiles.")
    board = list(st["board"])
    rack = list(st["racks"][seat])
    new, used = set(), []
    for t in tiles:
        try:
            r, c = int(t["r"]), int(t["c"])
            letter = str(t["l"])[:1]
        except (KeyError, TypeError, ValueError):
            raise Illegal("Bad tile.")
        if not (0 <= r < N and 0 <= c < N) or not letter.isalpha():
            raise Illegal("Bad tile.")
        if (r, c) in new or board[r * N + c]:
            raise Illegal("That square is taken.")
        blank = bool(t.get("blank"))
        need = "?" if blank else letter.upper()
        if need not in rack:
            raise Illegal("You don't have that tile.")
        rack.remove(need)
        used.append(need)
        board[r * N + c] = letter.lower() if blank else letter.upper()
        new.add((r, c))

    rows = {r for r, _ in new}
    cols = {c for _, c in new}
    if len(rows) > 1 and len(cols) > 1:
        raise Illegal("Tiles must be in one straight line.")
    if len(new) == 1:
        (r0, c0), = new
        h = _word_through(board, r0, c0, 0, 1)
        v = _word_through(board, r0, c0, 1, 0)
        dr, dc = (0, 1) if len(h) >= len(v) else (1, 0)
    else:
        dr, dc = (0, 1) if len(rows) == 1 else (1, 0)
    # contiguity
    first = min(new)
    main = _word_through(board, first[0], first[1], dr, dc)
    if not new.issubset(set(main)):
        raise Illegal("There's a gap in your word.")

    if st["first"]:
        if CENTER not in new:
            raise Illegal("The first word must cover the centre star.")
        if len(new) < 2:
            raise Illegal("The first word needs at least two letters.")
    else:
        touches = any(cell not in new for cell in main)
        for r, c in new:
            for ar, ac in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                if _at(board, r + ar, c + ac) and (r + ar, c + ac) not in new:
                    touches = True
        if not touches:
            raise Illegal("Your word must connect to tiles already on the board.")

    words = []
    if len(main) >= 2:
        words.append(main)
    for r, c in new:
        cross = _word_through(board, r, c, dc, dr)
        if len(cross) >= 2:
            words.append(cross)
    if not words:
        raise Illegal("Make a word of at least two letters.")

    spelled = ["".join(board[r * N + c] for r, c in w).upper() for w in words]
    if st["check"]:
        bad = [w for w in spelled if not is_word(w)]
        if bad:
            raise Illegal("Not in the word list: " + ", ".join(bad))
    score = sum(_score_word(board, w, new) for w in words)
    if len(new) == RACK:
        score += BINGO
    return spelled, score, used, board, [[list(cell) for cell in w] for w in words]


def _rack_value(rack):
    return sum(VALUES[t] for t in rack)


def _advance(st):
    out = st.get("out", [])
    s = st["turn"]
    for _ in range(st["seats"]):
        s = (s + 1) % st["seats"]
        if s not in out:
            break
    st["turn"] = s


def _end(st, went_out, reason):
    events = []
    adj = [0] * st["seats"]
    pool = 0
    for s in range(st["seats"]):
        if s == went_out:
            continue
        v = _rack_value(st["racks"][s])
        adj[s] -= v
        pool += v
    if went_out is not None:
        adj[went_out] += pool
    for s in range(st["seats"]):
        st["scores"][s] += adj[s]
    events.append({"type": "final", "adjust": adj, "scores": list(st["scores"])})
    out = st.get("out", [])
    alive = [s for s in range(st["seats"]) if s not in out]
    alive.sort(key=lambda s: -st["scores"][s])
    ranking = []
    for s in alive:
        if ranking and st["scores"][ranking[-1][0]] == st["scores"][s]:
            ranking[-1].append(s)
        else:
            ranking.append([s])
    ranking += [[s] for s in reversed(out)]
    events.append(finish(st, ranking, reason, list(st["scores"])))
    return events


def apply(st, seat, action, rng):
    if st["over"]:
        raise Illegal("This game is over.")
    kind = action.get("type")
    if kind == "resign":
        ev = resign(st, seat)
        if not st["over"]:
            st["bag"].extend(st["racks"][seat])
            rng.shuffle(st["bag"])
            st["racks"][seat] = []
            if st["turn"] == seat:
                _advance(st)
        return ev
    if seat != st["turn"]:
        raise Illegal("It isn't your turn.")

    active = st["seats"] - len(st.get("out", []))
    if kind == "play":
        words, score, used, board, cells = evaluate(st, seat, action.get("tiles") or [])
        placed = [{"r": int(t["r"]), "c": int(t["c"]),
                   "l": board[int(t["r"]) * N + int(t["c"])]} for t in action["tiles"]]
        st["board"] = board
        rack = st["racks"][seat]
        for u in used:
            rack.remove(u)
        while len(rack) < RACK and st["bag"]:
            rack.append(st["bag"].pop())
        st["scores"][seat] += score
        st["first"] = False
        st["scoreless"] = 0
        st["moves"] += 1
        st["last"] = {"seat": seat, "tiles": placed, "words": words, "score": score}
        st["log"].append({"seat": seat, "words": words, "score": score})
        st["log"] = st["log"][-30:]
        events = [{"type": "place", "seat": seat, "tiles": placed, "words": words,
                   "cells": cells, "score": score, "bingo": len(used) == RACK}]
        if not rack and not st["bag"]:
            events.extend(_end(st, seat, "played out"))
            return events
        _advance(st)
        return events

    if kind in ("pass", "swap"):
        if kind == "swap":
            letters = [str(x)[:1].upper() for x in action.get("letters") or []]
            if not letters:
                raise Illegal("Pick tiles to swap.")
            if len(st["bag"]) < RACK:
                raise Illegal("Fewer than seven tiles left — you can only pass.")
            rack = list(st["racks"][seat])
            for l in letters:
                if l not in rack:
                    raise Illegal("You don't have that tile.")
                rack.remove(l)
            fresh = [st["bag"].pop() for _ in letters]
            st["bag"].extend(letters)
            rng.shuffle(st["bag"])
            st["racks"][seat] = rack + fresh
            events = [{"type": "swap", "seat": seat, "count": len(letters)}]
        else:
            events = [{"type": "pass", "seat": seat}]
        st["scoreless"] += 1
        st["moves"] += 1
        st["last"] = {"seat": seat, "tiles": [], "words": [], "score": 0, "kind": kind}
        if st["scoreless"] >= 2 * active:
            events.extend(_end(st, None, "everyone passed"))
            return events
        _advance(st)
        return events

    raise Illegal("Unknown action.")


def public(st):
    return {
        "board": st["board"], "premium": PREMIUM, "scores": st["scores"],
        "bag": len(st["bag"]), "racks": [len(r) for r in st["racks"]],
        "turn": st["turn"], "over": st["over"], "result": st["result"],
        "moves": st["moves"], "last": st["last"], "log": st["log"][-8:],
        "first": st["first"], "check": st["check"], "out": st.get("out", []),
        "values": VALUES,
    }


def private(st, seat):
    if 0 <= seat < st["seats"]:
        return {"rack": st["racks"][seat]}
    return None
