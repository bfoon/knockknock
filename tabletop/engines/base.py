"""Shared contract for every tabletop rules engine.

An engine is a plain module (no Django) exposing:

    META                 {"key", "label", "emoji", "min", "max"}
    new_game(n, rng)     -> state (JSON-serialisable dict)
    public(state)        -> what every screen may see
    private(state, seat) -> what only that seat may see (or None)
    apply(state, seat, action, rng) -> [events]   (mutates state)

The server is the only authority. Phones send intentions ("move e2e4",
"roll", "play these tiles"); the engine checks them and answers with
*events*, which are what the big screen and the phones animate:

    {"type": "move", ...}      a piece travels
    {"type": "capture", ...}   attacker cuts the victim down
    {"type": "promote", ...}   a piece is crowned / promoted
    {"type": "roll", ...}      dice tumble
    {"type": "place", ...}     word tiles land

Common state keys every engine maintains:

    turn    seat index whose move it is (None when over)
    over    bool
    result  None or {"ranking": [[seat, ...], ...], "reason": str,
                     "scores": [int per seat]}
    moves   count of applied actions
"""


class Illegal(Exception):
    """A move the rules do not allow. The message is shown on the phone."""


def finish(state, ranking, reason, scores=None):
    state["over"] = True
    state["turn"] = None
    state["result"] = {
        "ranking": ranking,
        "reason": reason,
        "scores": scores if scores is not None else [0] * state["seats"],
    }
    return {"type": "over", "ranking": ranking, "reason": reason}


def resign(state, seat):
    """Generic resignation: the resigner drops to last place.

    Two-seat games end immediately. In 3-4 seat games the seat is marked
    out and play continues among the rest until one remains.
    """
    out = state.setdefault("out", [])
    if seat in out:
        raise Illegal("You have already left this game.")
    out.append(seat)
    alive = [s for s in range(state["seats"]) if s not in out]
    ev = [{"type": "resign", "seat": seat}]
    if len(alive) <= 1:
        ranking = [alive] + [[s] for s in reversed(out)]
        ev.append(finish(state, ranking, "resign", state.get("scores")))
    return ev
