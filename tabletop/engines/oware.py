"""Oware (Wori) — the West African sowing game, Abapa rules.

Twelve pits, four seeds in each. Seat 0 owns pits 0-5 (left to right along
the near row), seat 1 owns 6-11; sowing runs counter-clockwise 0 -> 11 -> 0.

  * Pick up every seed from one of your non-empty pits and sow them one per
    pit, counter-clockwise. With 12+ seeds the starting pit is skipped.
  * If the last seed lands in an opponent's pit and makes it 2 or 3, you
    capture it, then keep capturing backwards (clockwise) while the previous
    pit is also the opponent's and holds 2 or 3.
  * Grand slam: a move that would capture ALL the opponent's seeds is played
    but captures nothing.
  * You must feed: if the opponent has no seeds you must, if you can, play a
    move that gives them some. If you can't, the game ends and you keep the
    seeds still on your side.
  * More than 24 captured wins; 24-24 is a draw. If a game drags past 200
    moves, each side keeps what's on its own row.
"""

from .base import Illegal, finish, resign

META = {"key": "oware", "label": "Oware", "emoji": "🌰", "min": 2, "max": 2}
PITS = 12
START = 4
MOVE_CAP = 200


def new_game(n=2, rng=None):
    return {"seats": 2, "pits": [START] * PITS, "store": [0, 0], "turn": 0,
            "over": False, "result": None, "moves": 0, "last": None}


def own(seat):
    return range(0, 6) if seat == 0 else range(6, 12)


def _sow(pits, start):
    """Return (new_pits, path) — path lists every pit a seed landed in."""
    p = list(pits)
    seeds, p[start] = p[start], 0
    i, path = start, []
    while seeds:
        i = (i + 1) % PITS
        if i == start:
            continue
        p[i] += 1
        seeds -= 1
        path.append(i)
    return p, path


def _captures(pits, last, seat):
    opp = set(own(1 - seat))
    taken, i = [], last
    while i in opp and pits[i] in (2, 3):
        taken.append(i)
        i = (i - 1) % PITS
    return taken


def _simulate(st, seat, pit):
    p, path = _sow(st["pits"], pit)
    taken = _captures(p, path[-1], seat) if path else []
    opp_total = sum(p[i] for i in own(1 - seat))
    grand_slam = bool(taken) and sum(p[i] for i in taken) == opp_total
    if grand_slam:
        taken = []
    return p, path, taken, grand_slam


def legal(st):
    seat = st["turn"]
    if seat is None:
        return []
    moves = [i for i in own(seat) if st["pits"][i] > 0]
    opp_empty = sum(st["pits"][i] for i in own(1 - seat)) == 0
    if opp_empty:
        feeding = [m for m in moves
                   if sum(_simulate(st, seat, m)[0][i] for i in own(1 - seat)) > 0]
        return feeding        # empty -> no feeding move possible (handled by caller)
    return moves


def _end_by_rows(st, reason, events):
    for seat in (0, 1):
        st["store"][seat] += sum(st["pits"][i] for i in own(seat))
        for i in own(seat):
            st["pits"][i] = 0
    a, b = st["store"]
    ranking = [[0, 1]] if a == b else ([[0], [1]] if a > b else [[1], [0]])
    events.append({"type": "sweep", "store": list(st["store"])})
    events.append(finish(st, ranking, reason, list(st["store"])))


def apply(st, seat, action, rng=None):
    if st["over"]:
        raise Illegal("This game is over.")
    if action.get("type") == "resign":
        return resign(st, seat)
    if seat != st["turn"]:
        raise Illegal("It isn't your turn.")
    try:
        pit = int(action.get("pit"))
    except (TypeError, ValueError):
        raise Illegal("Pick one of your pits.")
    options = legal(st)
    if pit not in options:
        if pit not in own(seat):
            raise Illegal("That pit belongs to your opponent.")
        if st["pits"][pit] == 0:
            raise Illegal("That pit is empty.")
        raise Illegal("Your opponent has no seeds — you must play a move that feeds them.")

    p, path, taken, slam = _simulate(st, seat, pit)
    events = [{"type": "sow", "seat": seat, "from": pit, "path": path, "seeds": len(path)}]
    st["pits"] = p
    if taken:
        gain = sum(p[i] for i in taken)
        for i in taken:
            p[i] = 0
        st["store"][seat] += gain
        events.append({"type": "capture", "seat": seat, "pits": taken, "count": gain})
    elif slam:
        events.append({"type": "grandslam", "seat": seat})
    st["moves"] += 1
    st["last"] = {"seat": seat, "from": pit, "path": path, "taken": taken}
    st["turn"] = 1 - seat

    if st["store"][seat] > 24:
        events.append(finish(st, [[seat], [1 - seat]], "more than half the seeds", list(st["store"])))
    elif st["store"] == [24, 24]:
        events.append(finish(st, [[0, 1]], "24 each", list(st["store"])))
    elif not legal(st):
        _end_by_rows(st, "no seeds to play", events)
    elif st["moves"] >= MOVE_CAP:
        _end_by_rows(st, "move limit", events)
    return events


def public(st):
    return {"pits": st["pits"], "store": st["store"], "turn": st["turn"],
            "legal": legal(st) if not st["over"] else [], "last": st["last"],
            "over": st["over"], "result": st["result"], "moves": st["moves"],
            "out": st.get("out", [])}


def private(st, seat):
    return None
