"""Chess — full FIDE movement rules, server-authoritative.

Board: a 64-char string, index 0 = a1, 7 = h1, 63 = h8.
'.' empty, PNBRQK white, pnbrqk black. Seat 0 plays white.

Moves on the wire are UCI strings: "e2e4", "e7e8q" (promotion), "e1g1"
(castling is the king's two-square move).

Covered: castling (through/out of check forbidden), en passant,
under-promotion, check, checkmate, stalemate, fifty-move rule, threefold
repetition and insufficient material (K v K, K+minor v K, same-colour
bishops).
"""

from .base import Illegal, finish, resign

META = {"key": "chess", "label": "Chess", "emoji": "♞", "min": 2, "max": 2}

START = (
    "RNBQKBNR" + "P" * 8 + "." * 32 + "p" * 8 + "rnbqkbnr"
)
FILES = "abcdefgh"
KNIGHT = [(1, 2), (2, 1), (2, -1), (1, -2), (-1, -2), (-2, -1), (-2, 1), (-1, 2)]
KING = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)]
BISHOP = [(1, 1), (1, -1), (-1, 1), (-1, -1)]
ROOK = [(1, 0), (-1, 0), (0, 1), (0, -1)]
NAMES = {"p": "pawn", "n": "knight", "b": "bishop", "r": "rook", "q": "queen", "k": "king"}


def sq(name):
    return FILES.index(name[0]) + 8 * (int(name[1]) - 1)


def name(i):
    return FILES[i % 8] + str(i // 8 + 1)


def white(p):
    return p.isupper()


def side_of(p):
    return "w" if p.isupper() else "b"


def new_game(n=2, rng=None):
    st = {
        "seats": 2,
        "board": START,
        "side": "w",
        "castle": "KQkq",
        "ep": -1,
        "half": 0,
        "full": 1,
        "turn": 0,
        "over": False,
        "result": None,
        "moves": 0,
        "captured": {"w": "", "b": ""},  # pieces each side has taken
        "reps": {},
        "last": None,
        "check": False,
        "history": [],
    }
    st["reps"][_key(st)] = 1
    return st


def _key(st):
    return st["board"] + st["side"] + st["castle"] + str(st["ep"])


# ───────────────────────── move generation ─────────────────────────

def _attacked(b, target, by_white):
    """Is square `target` attacked by the given side on board `b`?"""
    tx, ty = target % 8, target // 8
    # pawns
    dy = -1 if by_white else 1
    for dx in (-1, 1):
        x, y = tx + dx, ty + dy
        if 0 <= x < 8 and 0 <= y < 8:
            p = b[x + 8 * y]
            if p == ("P" if by_white else "p"):
                return True
    for dx, dy in KNIGHT:
        x, y = tx + dx, ty + dy
        if 0 <= x < 8 and 0 <= y < 8 and b[x + 8 * y] == ("N" if by_white else "n"):
            return True
    for dx, dy in KING:
        x, y = tx + dx, ty + dy
        if 0 <= x < 8 and 0 <= y < 8 and b[x + 8 * y] == ("K" if by_white else "k"):
            return True
    for dirs, kinds in ((BISHOP, "BQ"), (ROOK, "RQ")):
        kinds = kinds if by_white else kinds.lower()
        for dx, dy in dirs:
            x, y = tx + dx, ty + dy
            while 0 <= x < 8 and 0 <= y < 8:
                p = b[x + 8 * y]
                if p != ".":
                    if p in kinds:
                        return True
                    break
                x += dx
                y += dy
    return False


def _pseudo(st):
    b, w = st["board"], st["side"] == "w"
    out = []
    for i, p in enumerate(b):
        if p == "." or white(p) != w:
            continue
        x, y = i % 8, i // 8
        k = p.lower()
        if k == "p":
            d = 1 if w else -1
            last = 7 if w else 0
            j = i + 8 * d
            if 0 <= j < 64 and b[j] == ".":
                _pawn_add(out, i, j, last)
                start = 1 if w else 6
                if y == start and b[i + 16 * d] == ".":
                    out.append((i, i + 16 * d, ""))
            for dx in (-1, 1):
                nx = x + dx
                if 0 <= nx < 8:
                    j = nx + 8 * (y + d)
                    if 0 <= j < 64:
                        t = b[j]
                        if (t != "." and white(t) != w) or j == st["ep"]:
                            _pawn_add(out, i, j, last)
        elif k in "nk":
            for dx, dy in (KNIGHT if k == "n" else KING):
                nx, ny = x + dx, y + dy
                if 0 <= nx < 8 and 0 <= ny < 8:
                    t = b[nx + 8 * ny]
                    if t == "." or white(t) != w:
                        out.append((i, nx + 8 * ny, ""))
            if k == "k":
                out.extend(_castles(st, i, w))
        else:
            dirs = BISHOP if k == "b" else ROOK if k == "r" else BISHOP + ROOK
            for dx, dy in dirs:
                nx, ny = x + dx, y + dy
                while 0 <= nx < 8 and 0 <= ny < 8:
                    t = b[nx + 8 * ny]
                    if t == ".":
                        out.append((i, nx + 8 * ny, ""))
                    else:
                        if white(t) != w:
                            out.append((i, nx + 8 * ny, ""))
                        break
                    nx += dx
                    ny += dy
    return out


def _pawn_add(out, i, j, last):
    if j // 8 == last:
        for promo in "qrbn":
            out.append((i, j, promo))
    else:
        out.append((i, j, ""))


def _castles(st, i, w):
    b, c = st["board"], st["castle"]
    res = []
    home = 4 if w else 60
    if i != home or _attacked(b, i, not w):
        return res
    ks, qs = ("K", "Q") if w else ("k", "q")
    rook = "R" if w else "r"
    if ks in c and b[i + 1] == "." and b[i + 2] == "." and b[i + 3] == rook:
        if not _attacked(b, i + 1, not w) and not _attacked(b, i + 2, not w):
            res.append((i, i + 2, ""))
    if qs in c and b[i - 1] == "." and b[i - 2] == "." and b[i - 3] == "." and b[i - 4] == rook:
        if not _attacked(b, i - 1, not w) and not _attacked(b, i - 2, not w):
            res.append((i, i - 2, ""))
    return res


def _make(st, mv):
    """Return (new_board, info) without touching st."""
    a, z, promo = mv
    b = list(st["board"])
    p = b[a]
    info = {"piece": p, "captured": None, "cap_sq": None, "rook": None, "ep_new": -1}
    if b[z] != ".":
        info["captured"], info["cap_sq"] = b[z], z
    if p in "Pp" and z == st["ep"] and b[z] == ".":
        cap = z - 8 if p == "P" else z + 8
        info["captured"], info["cap_sq"] = b[cap], cap
        b[cap] = "."
    if p in "Kk" and abs(z - a) == 2:
        if z > a:
            b[a + 1], b[a + 3] = b[a + 3], "."
            info["rook"] = (a + 3, a + 1)
        else:
            b[a - 1], b[a - 4] = b[a - 4], "."
            info["rook"] = (a - 4, a - 1)
    if p in "Pp" and abs(z - a) == 16:
        info["ep_new"] = (a + z) // 2
    b[z] = (promo.upper() if p.isupper() else promo) if promo else p
    b[a] = "."
    return "".join(b), info


def _king_sq(b, w):
    return b.find("K" if w else "k")


def legal(st):
    w = st["side"] == "w"
    res = []
    for mv in _pseudo(st):
        nb, _ = _make(st, mv)
        if not _attacked(nb, _king_sq(nb, w), not w):
            res.append(mv)
    return res


def uci(mv):
    return name(mv[0]) + name(mv[1]) + mv[2]


# ───────────────────────── applying moves ─────────────────────────

def _insufficient(b):
    rest = [p for p in b if p not in ".Kk"]
    if not rest:
        return True
    if len(rest) == 1 and rest[0] in "NBnb":
        return True
    if all(p in "Bb" for p in rest):
        colours = {((i % 8) + (i // 8)) % 2 for i, p in enumerate(b) if p in "Bb"}
        return len(colours) == 1
    return False


def apply(st, seat, action, rng=None):
    if st["over"]:
        raise Illegal("This game is over.")
    kind = action.get("type")
    if kind == "resign":
        return resign(st, seat)
    if seat != st["turn"]:
        raise Illegal("It isn't your turn.")
    text = str(action.get("move", "")).strip().lower()
    moves = legal(st)
    mv = next((m for m in moves if uci(m) == text), None)
    if mv is None and len(text) == 4:  # promotion without a letter: queen
        mv = next((m for m in moves if uci(m) == text + "q"), None)
    if mv is None:
        raise Illegal("That move isn't allowed.")

    nb, info = _make(st, mv)
    a, z, promo = mv
    p = info["piece"]
    w = st["side"] == "w"
    events = []
    if info["captured"]:
        events.append({
            "type": "capture",
            "attacker": name(a), "victim": name(info["cap_sq"]),
            "piece": p, "taken": info["captured"],
            "kind": NAMES[info["captured"].lower()],
            "ep": info["cap_sq"] != z,
        })
        st["captured"][st["side"]] += info["captured"]
    events.append({"type": "move", "from": name(a), "to": name(z), "piece": p,
                   "kind": NAMES[p.lower()]})
    if info["rook"]:
        events.append({"type": "castle", "from": name(info["rook"][0]),
                       "to": name(info["rook"][1]), "piece": "R" if w else "r"})
    if promo:
        events.append({"type": "promote", "at": name(z),
                       "piece": promo.upper() if w else promo})

    # castling rights
    c = st["castle"]
    if p == "K":
        c = c.replace("K", "").replace("Q", "")
    if p == "k":
        c = c.replace("k", "").replace("q", "")
    for corner, right in ((0, "Q"), (7, "K"), (56, "q"), (63, "k")):
        if a == corner or z == corner:
            c = c.replace(right, "")
    st["castle"] = c
    st["board"] = nb
    st["ep"] = info["ep_new"]
    st["half"] = 0 if (p in "Pp" or info["captured"]) else st["half"] + 1
    if not w:
        st["full"] += 1
    st["side"] = "b" if w else "w"
    st["turn"] = 1 - seat
    st["moves"] += 1
    st["last"] = [name(a), name(z)]
    st["history"].append(uci(mv))
    k = _key(st)
    st["reps"][k] = st["reps"].get(k, 0) + 1

    nxt = legal(st)
    in_check = _attacked(nb, _king_sq(nb, not w), w)
    st["check"] = in_check
    if in_check:
        events.append({"type": "check", "at": name(_king_sq(nb, not w))})
    if not nxt:
        if in_check:
            events.append(finish(st, [[seat], [1 - seat]], "checkmate"))
        else:
            events.append(finish(st, [[0, 1]], "stalemate"))
    elif st["half"] >= 100:
        events.append(finish(st, [[0, 1]], "fifty-move rule"))
    elif st["reps"][k] >= 3:
        events.append(finish(st, [[0, 1]], "threefold repetition"))
    elif _insufficient(nb):
        events.append(finish(st, [[0, 1]], "insufficient material"))
    return events


def public(st):
    return {
        "board": st["board"],
        "side": st["side"],
        "turn": st["turn"],
        "check": st["check"],
        "last": st["last"],
        "captured": st["captured"],
        "legal": [] if st["over"] else [uci(m) for m in legal(st)],
        "over": st["over"],
        "result": st["result"],
        "moves": st["moves"],
        "out": st.get("out", []),
    }


def private(st, seat):
    return None
