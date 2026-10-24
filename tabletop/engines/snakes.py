"""Snakes & Ladders — 2 to 4 players, server-rolled dice.

Squares 1..100, everyone starts off the board (0). Roll and move; land at
the foot of a ladder to climb it, on a snake's head to slide down its tail.
You need the exact number to finish on 100 — any extra and you bounce back.
A 6 rolls again (but three 6s in a row sends you back where the turn began).

The board is the same every game so people learn its snakes by heart:
SNAKES maps head -> tail, LADDERS maps foot -> top.
"""

from .base import Illegal, finish, resign

META = {"key": "snakes", "label": "Snakes & Ladders", "emoji": "🐍", "min": 2, "max": 4}
GOAL = 100
LADDERS = {4: 25, 13: 46, 33: 49, 42: 63, 50: 69, 62: 81, 74: 92}
SNAKES = {27: 5, 40: 3, 43: 18, 54: 31, 66: 45, 76: 58, 89: 53, 99: 41}


def new_game(n=2, rng=None):
    n = max(2, min(4, n))
    return {"seats": n, "pos": [0] * n, "turn": 0, "sixes": 0, "turn_start": 0,
            "over": False, "result": None, "moves": 0, "last": None,
            "climbs": [0] * n, "bites": [0] * n}


def _next(st):
    out = st.get("out", [])
    s = st["turn"]
    for _ in range(st["seats"]):
        s = (s + 1) % st["seats"]
        if s not in out:
            break
    st["turn"], st["sixes"] = s, 0
    st["turn_start"] = st["pos"][s]


def apply(st, seat, action, rng):
    if st["over"]:
        raise Illegal("This game is over.")
    if action.get("type") == "resign":
        ev = resign(st, seat)
        if not st["over"] and st["turn"] == seat:
            _next(st)
        return ev
    if seat != st["turn"]:
        raise Illegal("It isn't your turn.")
    if action.get("type") != "roll":
        raise Illegal("Tap Roll.")

    d = rng.randint(1, 6)
    st["moves"] += 1
    frm = st["pos"][seat]
    events = [{"type": "roll", "seat": seat, "value": d}]
    if d == 6:
        st["sixes"] += 1
        if st["sixes"] == 3:
            st["pos"][seat] = st["turn_start"]
            events.append({"type": "forfeit", "seat": seat, "to": st["turn_start"], "reason": "three sixes"})
            _next(st)
            return events
    to = frm + d
    path = list(range(frm + 1, min(to, GOAL) + 1))
    if to > GOAL:                       # bounce back off 100
        to = GOAL - (to - GOAL)
        path += list(range(GOAL - 1, to - 1, -1))
    events.append({"type": "move", "seat": seat, "from": frm, "to": to, "path": path,
                   "bounce": frm + d > GOAL})
    if to in LADDERS:
        events.append({"type": "ladder", "seat": seat, "from": to, "to": LADDERS[to]})
        st["climbs"][seat] += 1
        to = LADDERS[to]
    elif to in SNAKES:
        events.append({"type": "snake", "seat": seat, "from": to, "to": SNAKES[to]})
        st["bites"][seat] += 1
        to = SNAKES[to]
    st["pos"][seat] = to
    st["last"] = {"seat": seat, "roll": d, "to": to}
    if to == GOAL:
        out = st.get("out", [])
        rest = sorted((s for s in range(st["seats"]) if s != seat and s not in out),
                      key=lambda s: -st["pos"][s])
        ranking = [[seat]] + [[s] for s in rest] + [[s] for s in reversed(out)]
        events.append(finish(st, ranking, "reached 100", list(st["pos"])))
        return events
    if d == 6:
        events.append({"type": "bonus", "seat": seat})
    else:
        _next(st)
    return events


def public(st):
    return {"pos": st["pos"], "turn": st["turn"], "last": st["last"], "over": st["over"],
            "result": st["result"], "moves": st["moves"], "climbs": st["climbs"],
            "bites": st["bites"], "out": st.get("out", []),
            "snakes": SNAKES, "ladders": LADDERS}


def private(st, seat):
    return None
