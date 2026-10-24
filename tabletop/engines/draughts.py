"""Dam — international draughts, the way it's played across Senegambia.

10x10 board by default (8x8 also supported), seat 0 plays the light pieces
and starts. Rules:

  * Men step one square diagonally forward, but capture forwards AND
    backwards.
  * Kings ("dam") fly: they slide any distance and capture from range,
    landing on any empty square beyond the captured piece.
  * Capturing is compulsory, and you must take the line that captures the
    MOST pieces (majority rule). Between equal lines you may choose.
  * Captured pieces stay on the board until the sequence ends (they can't
    be jumped twice and they block the way), then all vanish together.
  * A man is crowned only if its move ENDS on the far row.
  * You lose when you have no pieces or no legal move.
  * Draw after 50 plies of king-only moves with no capture, or a threefold
    repetition.

Squares are indexed r * size + c, r = 0 being seat 0's back row.
Board string: '.' empty, 'w' / 'b' men, 'W' / 'B' kings.
"""

from .base import Illegal, finish, resign

META = {"key": "dam", "label": "Dam", "emoji": "⛀", "min": 2, "max": 2}
DIRS = [(1, 1), (1, -1), (-1, 1), (-1, -1)]


def new_game(n=2, rng=None, size=10):
    rows = 4 if size == 10 else 3
    b = []
    for r in range(size):
        for c in range(size):
            if (r + c) % 2:
                b.append(".")
            elif r < rows:
                b.append("w")
            elif r >= size - rows:
                b.append("b")
            else:
                b.append(".")
    st = {
        "seats": 2, "size": size, "board": "".join(b), "turn": 0,
        "over": False, "result": None, "moves": 0, "quiet": 0,
        "reps": {}, "last": None, "captured": [0, 0],
    }
    st["reps"][st["board"] + "0"] = 1
    return st


def _mine(p, seat):
    return p != "." and (p.lower() == "w") == (seat == 0)


def _captures_from(b, size, start, seat):
    """All maximal capture paths for the piece on `start`."""
    piece = b[start]
    king = piece.isupper()
    results = []

    def at(r, c):
        return b[r * size + c]

    def dfs(r, c, path, caps):
        extended = False
        for dr, dc in DIRS:
            if king:
                rr, cc = r + dr, c + dc
                # slide over empties (the start square counts as empty)
                while 0 <= rr < size and 0 <= cc < size and (
                        at(rr, cc) == "." or rr * size + cc == start):
                    rr += dr
                    cc += dc
                if not (0 <= rr < size and 0 <= cc < size):
                    continue
                v = rr * size + cc
                if v in caps or not (b[v] != "." and not _mine(b[v], seat)):
                    continue
                lr, lc = rr + dr, cc + dc
                while 0 <= lr < size and 0 <= lc < size and (
                        at(lr, lc) == "." or lr * size + lc == start):
                    extended = True
                    dfs(lr, lc, path + [lr * size + lc], caps + [v])
                    lr += dr
                    lc += dc
            else:
                rr, cc, lr, lc = r + dr, c + dc, r + 2 * dr, c + 2 * dc
                if not (0 <= lr < size and 0 <= lc < size):
                    continue
                v = rr * size + cc
                land = lr * size + lc
                if v in caps or b[v] == "." or _mine(b[v], seat):
                    continue
                if b[land] != "." and land != start:
                    continue
                extended = True
                dfs(lr, lc, path + [land], caps + [v])
        if not extended and caps:
            results.append((path, caps))

    r0, c0 = divmod(start, size)
    dfs(r0, c0, [start], [])
    return results


def legal(st):
    b, size, seat = st["board"], st["size"], st["turn"]
    if seat is None:
        return []
    caps = []
    for i, p in enumerate(b):
        if _mine(p, seat):
            caps.extend(_captures_from(b, size, i, seat))
    if caps:
        best = max(len(c) for _, c in caps)
        seen, out = set(), []
        for path, c in caps:
            if len(c) == best:
                key = (tuple(path), tuple(sorted(c)))
                if key not in seen:
                    seen.add(key)
                    out.append({"path": path, "caps": c})
        return out
    out = []
    fwd = 1 if seat == 0 else -1
    for i, p in enumerate(b):
        if not _mine(p, seat):
            continue
        r, c = divmod(i, size)
        for dr, dc in DIRS:
            if p.islower():
                if dr != fwd:
                    continue
                rr, cc = r + dr, c + dc
                if 0 <= rr < size and 0 <= cc < size and b[rr * size + cc] == ".":
                    out.append({"path": [i, rr * size + cc], "caps": []})
            else:
                rr, cc = r + dr, c + dc
                while 0 <= rr < size and 0 <= cc < size and b[rr * size + cc] == ".":
                    out.append({"path": [i, rr * size + cc], "caps": []})
                    rr += dr
                    cc += dc
    return out


def apply(st, seat, action, rng=None):
    if st["over"]:
        raise Illegal("This game is over.")
    if action.get("type") == "resign":
        return resign(st, seat)
    if seat != st["turn"]:
        raise Illegal("It isn't your turn.")
    try:
        path = [int(x) for x in action.get("path", [])]
    except (TypeError, ValueError):
        raise Illegal("That move isn't allowed.")
    options = legal(st)
    chosen = next((o for o in options if o["path"] == path), None)
    if chosen is None and len(path) == 2:
        # phone sent only start + final square; accept if unambiguous
        hits = [o for o in options if o["path"][0] == path[0] and o["path"][-1] == path[1]]
        if len(hits) >= 1:
            chosen = hits[0]
    if chosen is None:
        if any(o["caps"] for o in options):
            raise Illegal("You must capture — and take the most pieces you can.")
        raise Illegal("That move isn't allowed.")

    size = st["size"]
    b = list(st["board"])
    start, end = chosen["path"][0], chosen["path"][-1]
    piece = b[start]
    events = []
    if chosen["caps"]:
        events.append({"type": "jump", "path": chosen["path"], "victims": chosen["caps"],
                       "taken": [b[v] for v in chosen["caps"]], "piece": piece})
        for v in chosen["caps"]:
            b[v] = "."
        st["captured"][seat] += len(chosen["caps"])
    else:
        events.append({"type": "move", "path": chosen["path"], "piece": piece})
    b[start] = "."
    last_row = size - 1 if seat == 0 else 0
    if piece.islower() and end // size == last_row:
        piece = piece.upper()
        events.append({"type": "promote", "at": end, "piece": piece})
    b[end] = piece
    st["board"] = "".join(b)
    st["last"] = chosen["path"]
    st["moves"] += 1
    if chosen["caps"] or b[end].islower() or events[-1]["type"] == "promote":
        st["quiet"] = 0
    else:
        st["quiet"] += 1
    st["turn"] = 1 - seat
    key = st["board"] + str(st["turn"])
    st["reps"][key] = st["reps"].get(key, 0) + 1

    if not legal(st):
        events.append(finish(st, [[seat], [1 - seat]], "no moves left"))
    elif st["quiet"] >= 50:
        events.append(finish(st, [[0, 1]], "50 quiet king moves"))
    elif st["reps"][key] >= 3:
        events.append(finish(st, [[0, 1]], "threefold repetition"))
    return events


def public(st):
    return {
        "board": st["board"], "size": st["size"], "turn": st["turn"],
        "last": st["last"], "captured": st["captured"],
        "legal": legal(st) if not st["over"] else [],
        "over": st["over"], "result": st["result"], "moves": st["moves"],
        "out": st.get("out", []),
    }


def private(st, seat):
    return None
