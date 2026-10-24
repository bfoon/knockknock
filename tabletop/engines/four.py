"""Four in a Row — drop discs into a 7x6 frame; four in a line wins."""

from .base import Illegal, finish, resign

META = {"key": "four", "label": "Four in a Row", "emoji": "🔴", "min": 2, "max": 2}
COLS, ROWS = 7, 6


def new_game(n=2, rng=None):
    # grid[r][c], r = 0 is the bottom row; values -1 empty or seat
    return {"seats": 2, "grid": [[-1] * COLS for _ in range(ROWS)], "turn": 0,
            "over": False, "result": None, "moves": 0, "last": None, "line": None}


def _line(g, r, c, s):
    for dr, dc in ((0, 1), (1, 0), (1, 1), (1, -1)):
        cells = [(r, c)]
        for sign in (1, -1):
            rr, cc = r + dr * sign, c + dc * sign
            while 0 <= rr < ROWS and 0 <= cc < COLS and g[rr][cc] == s:
                cells.append((rr, cc))
                rr += dr * sign
                cc += dc * sign
        if len(cells) >= 4:
            return sorted(cells)
    return None


def apply(st, seat, action, rng=None):
    if st["over"]:
        raise Illegal("This game is over.")
    if action.get("type") == "resign":
        return resign(st, seat)
    if seat != st["turn"]:
        raise Illegal("It isn't your turn.")
    try:
        c = int(action.get("col"))
    except (TypeError, ValueError):
        raise Illegal("Pick a column.")
    if not 0 <= c < COLS:
        raise Illegal("Pick a column.")
    g = st["grid"]
    r = next((r for r in range(ROWS) if g[r][c] == -1), None)
    if r is None:
        raise Illegal("That column is full.")
    g[r][c] = seat
    st["moves"] += 1
    st["last"] = [r, c]
    events = [{"type": "drop", "seat": seat, "col": c, "row": r}]
    line = _line(g, r, c, seat)
    if line:
        st["line"] = line
        events.append({"type": "line", "seat": seat, "cells": line})
        events.append(finish(st, [[seat], [1 - seat]], "four in a row"))
    elif st["moves"] == ROWS * COLS:
        events.append(finish(st, [[0, 1]], "board full"))
    else:
        st["turn"] = 1 - seat
    return events


def public(st):
    return {"grid": st["grid"], "turn": st["turn"], "last": st["last"], "line": st["line"],
            "over": st["over"], "result": st["result"], "moves": st["moves"],
            "out": st.get("out", [])}


def private(st, seat):
    return None
