"""Ludo — 2 to 4 players, server-rolled dice.

Colours: 0 red, 1 green, 2 yellow, 3 blue, clockwise. Two players take
opposite corners (red & yellow) so the race is fair.

Each token has a position relative to its own colour:
    -1        in the yard (base)
    0 .. 50   on the shared 52-square track (0 = own start square)
    51 .. 55  on its own home column
    56        home (finished)

Rules used (the common house rules, tuned for a quick party game):
  * Roll a 6 to bring a token out onto its start square.
  * A 6 earns another roll; a third 6 in a row forfeits the turn.
  * Landing on an opponent on a non-safe square cuts it down: it goes back
    to its yard and you roll again.
  * Start squares and star squares are safe.
  * You need the exact number to reach home; getting a token home earns
    another roll.
  * First player with all four tokens home wins; the rest are ranked by
    how far their tokens got.
  * If only one token can move, it moves by itself.
"""

from .base import Illegal, finish, resign

META = {"key": "ludo", "label": "Ludo", "emoji": "🎲", "min": 2, "max": 4}
TRACK = 52
HOME = 56
SAFE = {0, 8, 13, 21, 26, 34, 39, 47}
COLOUR_NAMES = ["red", "green", "yellow", "blue"]


def colours_for(n):
    return {2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3]}[n]


def new_game(n=4, rng=None):
    n = max(2, min(4, n))
    return {
        "seats": n,
        "colours": colours_for(n),
        "tokens": [[-1] * 4 for _ in range(n)],
        "turn": 0,
        "phase": "roll",
        "dice": None,
        "sixes": 0,
        "movable": [],
        "over": False,
        "result": None,
        "moves": 0,
        "kills": [0] * n,
        "last": None,
    }


def glob(colour, rel):
    """Global track square for a relative position, None off the track."""
    if 0 <= rel <= 50:
        return (colour * 13 + rel) % TRACK
    return None


def _target(rel, dice):
    if rel == -1:
        return 0 if dice == 6 else None
    if rel == HOME:
        return None
    t = rel + dice
    return t if t <= HOME else None


def _movable(st, seat, dice):
    return [k for k, rel in enumerate(st["tokens"][seat]) if _target(rel, dice) is not None]


def _next_turn(st):
    out = st.get("out", [])
    n = st["seats"]
    s = st["turn"]
    for _ in range(n):
        s = (s + 1) % n
        if s not in out:
            break
    st["turn"] = s
    st["phase"] = "roll"
    st["dice"] = None
    st["sixes"] = 0
    st["movable"] = []


def progress(st, seat):
    return sum(0 if r < 0 else r + 1 for r in st["tokens"][seat])


def _ranking(st, winner):
    out = st.get("out", [])
    rest = [s for s in range(st["seats"]) if s != winner and s not in out]
    rest.sort(key=lambda s: -progress(st, s))
    return [[winner]] + [[s] for s in rest] + [[s] for s in reversed(out)]


def apply(st, seat, action, rng):
    if st["over"]:
        raise Illegal("This game is over.")
    kind = action.get("type")
    if kind == "resign":
        ev = resign(st, seat)
        st["tokens"][seat] = [-1] * 4   # their pieces leave the board
        if not st["over"] and st["turn"] == seat:
            _next_turn(st)
        return ev
    if seat != st["turn"]:
        raise Illegal("It isn't your turn.")

    if kind == "roll":
        if st["phase"] != "roll":
            raise Illegal("Move a token first.")
        dice = rng.randint(1, 6)
        st["dice"] = dice
        st["moves"] += 1
        events = [{"type": "roll", "seat": seat, "value": dice,
                   "colour": st["colours"][seat]}]
        if dice == 6:
            st["sixes"] += 1
            if st["sixes"] >= 3:
                events.append({"type": "forfeit", "seat": seat, "reason": "three sixes"})
                _next_turn(st)
                return events
        mov = _movable(st, seat, dice)
        if not mov:
            events.append({"type": "no_move", "seat": seat})
            _next_turn(st)
            return events
        st["phase"] = "move"
        st["movable"] = mov
        if len(set(st["tokens"][seat][k] for k in mov)) == 1:
            # every option is the same move (e.g. all in the yard) -> auto
            events.extend(_move(st, seat, mov[0]))
        return events

    if kind == "move":
        if st["phase"] != "move":
            raise Illegal("Roll the dice first.")
        try:
            k = int(action.get("token"))
        except (TypeError, ValueError):
            raise Illegal("Pick one of your glowing tokens.")
        if k not in st["movable"]:
            raise Illegal("That token can't move with this roll.")
        return _move(st, seat, k)

    raise Illegal("Unknown action.")


def _move(st, seat, k):
    dice = st["dice"]
    colour = st["colours"][seat]
    frm = st["tokens"][seat][k]
    to = _target(frm, dice)
    path = [0] if frm == -1 else list(range(frm + 1, to + 1))
    st["tokens"][seat][k] = to
    st["last"] = {"seat": seat, "token": k}
    events = [{"type": "move", "seat": seat, "colour": colour, "token": k,
               "from": frm, "to": to, "path": path}]
    bonus = dice == 6
    g = glob(colour, to)
    if g is not None and g not in SAFE:
        victims = []
        for s2 in range(st["seats"]):
            if s2 == seat:
                continue
            c2 = st["colours"][s2]
            for k2, r2 in enumerate(st["tokens"][s2]):
                if glob(c2, r2) == g:
                    victims.append({"seat": s2, "colour": c2, "token": k2, "from": r2})
                    st["tokens"][s2][k2] = -1
        if victims:
            st["kills"][seat] += len(victims)
            events.append({"type": "capture", "seat": seat, "colour": colour,
                           "token": k, "at": g, "victims": victims})
            bonus = True
    if to == HOME:
        events.append({"type": "home", "seat": seat, "colour": colour, "token": k})
        bonus = True
        if all(r == HOME for r in st["tokens"][seat]):
            events.append(finish(st, _ranking(st, seat), "all tokens home",
                                 [progress(st, s) for s in range(st["seats"])]))
            return events
    if bonus:
        st["phase"] = "roll"
        st["dice"] = None
        st["movable"] = []
        events.append({"type": "bonus", "seat": seat})
    else:
        _next_turn(st)
    return events


def public(st):
    return {
        "tokens": st["tokens"], "colours": st["colours"], "turn": st["turn"],
        "phase": st["phase"], "dice": st["dice"], "movable": st["movable"],
        "over": st["over"], "result": st["result"], "moves": st["moves"],
        "kills": st["kills"], "last": st["last"], "out": st.get("out", []),
        "safe": sorted(SAFE),
    }


def private(st, seat):
    return None
