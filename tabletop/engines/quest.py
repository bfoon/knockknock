"""Dragon's Hoard — a race-and-battle adventure for 2 to 4 heroes.

The players' own Hero Forge characters travel a 42-tile island path toward
the dragon's lair. On your turn choose:

    roll    move 1-6 tiles. A live monster BLOCKS the path: you stop on its
            tile and fight it. Then the tile you end on takes effect.
    rest    camp where you are and heal 4 (no move).
    potion  drink a potion (+5 HP). Free — you still take your turn after.

Tiles: campfire (full heal + checkpoint), chest (gold, sword, shield or a
potion), potion, trap (-2 HP), portal (leap ahead), monsters (goblin, slime,
bat, skeleton, troll) and, at the end, the DRAGON.

Fights are automatic rounds of dice: you hit if d6 + attack >= the monster's
defence (a natural 6 hits twice as hard); the monster then hits back on 3+
for its attack minus your armour. Monsters you slay stay dead and pay gold.
Fall to 0 HP and you're carried back to your last campfire, dropping half
your gold.

The dragon fights three rounds per visit and keeps its wounds, so heroes
can gang up on it. Whoever lands the final blow takes the hoard (+25 gold)
and ends the quest. Everyone is ranked by gold.
"""

from .base import Illegal, finish, resign

META = {"key": "quest", "label": "Dragon's Hoard", "emoji": "🐉", "min": 2, "max": 4}

LAYOUT = [
    "camp", "path", "slime", "chest", "path", "trap", "goblin", "potion", "path", "portal",
    "bat", "chest", "path", "goblin", "camp", "path", "skeleton", "chest", "trap", "slime",
    "potion", "portal", "bat", "path", "goblin", "chest", "path", "trap", "camp", "skeleton",
    "chest", "troll", "path", "potion", "bat", "trap", "chest", "skeleton", "path", "potion",
    "troll", "dragon",
]
LAST = len(LAYOUT) - 1
PORTAL_JUMP = 5
MONSTERS = {  # hp, attack, defence, gold
    "slime": (1, 1, 2, 2), "bat": (1, 1, 4, 3), "goblin": (2, 2, 3, 3),
    "skeleton": (3, 2, 4, 5), "troll": (4, 3, 4, 8), "dragon": (14, 3, 4, 25),
}
MAX_HP = 10
MAX_ROUNDS = 8          # a normal fight always ends within this many rounds
DRAGON_ROUNDS = 3       # the dragon retreats into smoke after three exchanges
MOVE_CAP = 500


def new_game(n=2, rng=None):
    n = max(2, min(4, n))
    monsters = {}
    for i, kind in enumerate(LAYOUT):
        if kind in MONSTERS:
            monsters[str(i)] = {"kind": kind, "hp": MONSTERS[kind][0], "max": MONSTERS[kind][0]}
    heroes = [{"pos": 0, "hp": MAX_HP, "gold": 0, "atk": 0, "armor": 0, "potions": 1,
               "camp": 0, "kills": 0, "kos": 0} for _ in range(n)]
    return {"seats": n, "heroes": heroes, "monsters": monsters, "turn": 0,
            "over": False, "result": None, "moves": 0, "last": None, "log": []}


def _d6(rng):
    return rng.randint(1, 6)


def _next(st):
    out = st.get("out", [])
    s = st["turn"]
    for _ in range(st["seats"]):
        s = (s + 1) % st["seats"]
        if s not in out:
            break
    st["turn"] = s


def _log(st, text):
    st["log"].append(text)
    st["log"] = st["log"][-12:]


def _ko(st, seat, events):
    h = st["heroes"][seat]
    lost = h["gold"] // 2
    h["gold"] -= lost
    h["hp"] = MAX_HP
    h["kos"] += 1
    frm, h["pos"] = h["pos"], h["camp"]
    events.append({"type": "ko", "seat": seat, "from": frm, "to": h["camp"], "lost": lost})


def _fight(st, seat, tile, rng, events):
    """Resolve a fight on `tile`. Returns True if the hero is still standing."""
    h = st["heroes"][seat]
    m = st["monsters"][str(tile)]
    kind = m["kind"]
    _, matk, mdef, gold = MONSTERS[kind]
    rounds = []
    limit = DRAGON_ROUNDS if kind == "dragon" else MAX_ROUNDS
    for _ in range(limit):
        r = {"hero": _d6(rng)}
        r["hit"] = r["hero"] + h["atk"] >= mdef
        r["dmg"] = (2 if r["hero"] == 6 else 1) if r["hit"] else 0
        m["hp"] = max(0, m["hp"] - r["dmg"])
        if m["hp"] > 0:
            r["mon"] = _d6(rng)
            r["mhit"] = r["mon"] >= 3
            r["mdmg"] = max(1, matk - h["armor"]) if r["mhit"] else 0
            h["hp"] = max(0, h["hp"] - r["mdmg"])
        r["monHp"], r["heroHp"] = m["hp"], h["hp"]
        rounds.append(r)
        if m["hp"] == 0 or h["hp"] == 0:
            break
    if m["hp"] == 0:
        result = "win"
    elif h["hp"] == 0:
        result = "ko"
    else:
        result = "retreat"
    ev = {"type": "fight", "seat": seat, "at": tile, "monster": kind, "rounds": rounds,
          "result": result, "max": m["max"]}
    events.append(ev)
    if result == "win":
        h["gold"] += gold
        h["kills"] += 1
        ev["gold"] = gold
        del st["monsters"][str(tile)]
        _log(st, f"slew the {kind} (+{gold} gold)")
        if kind == "dragon":
            events.append({"type": "slay", "seat": seat, "gold": gold})
            return True
    elif result == "ko":
        _log(st, f"was knocked out by the {kind}")
        _ko(st, seat, events)
        return False
    if h["hp"] <= 3 and h["potions"] and result != "ko":
        _drink(st, seat, events, auto=True)
    return True


def _drink(st, seat, events, auto=False):
    h = st["heroes"][seat]
    h["potions"] -= 1
    heal = min(5, MAX_HP - h["hp"])
    h["hp"] += heal
    events.append({"type": "drink", "seat": seat, "heal": heal, "auto": auto})


def _land(st, seat, tile, rng, events, portal_ok=True):
    h = st["heroes"][seat]
    kind = LAYOUT[tile]
    if str(tile) in st["monsters"]:
        return _fight(st, seat, tile, rng, events)
    if kind == "camp":
        heal = MAX_HP - h["hp"]
        h["hp"] = MAX_HP
        h["camp"] = tile
        events.append({"type": "camp", "seat": seat, "at": tile, "heal": heal})
    elif kind == "chest":
        roll = _d6(rng)
        if roll <= 3:
            g = 2 + _d6(rng)
            h["gold"] += g
            loot = {"gold": g}
        elif roll == 4 and h["atk"] < 3:
            h["atk"] += 1
            loot = {"item": "sword"}
        elif roll == 5 and h["armor"] < 2:
            h["armor"] += 1
            loot = {"item": "shield"}
        else:
            h["potions"] = min(3, h["potions"] + 1)
            loot = {"item": "potion"}
        events.append({"type": "chest", "seat": seat, "at": tile, "loot": loot})
    elif kind == "potion":
        h["potions"] = min(3, h["potions"] + 1)
        events.append({"type": "potion", "seat": seat, "at": tile})
    elif kind == "trap":
        dmg = max(1, 2 - h["armor"] // 2)
        h["hp"] = max(0, h["hp"] - dmg)
        events.append({"type": "trap", "seat": seat, "at": tile, "dmg": dmg})
        if h["hp"] == 0:
            _ko(st, seat, events)
            return False
    elif kind == "portal" and portal_ok:
        to = min(LAST, tile + PORTAL_JUMP)
        # a portal won't drop you past a live monster: it lands on the guard
        for t in range(tile + 1, to + 1):
            if str(t) in st["monsters"]:
                to = t
                break
        h["pos"] = to
        events.append({"type": "portal", "seat": seat, "from": tile, "to": to})
        return _land(st, seat, to, rng, events, portal_ok=False)
    return True


def _rank(st):
    out = st.get("out", [])
    alive = sorted((s for s in range(st["seats"]) if s not in out),
                   key=lambda s: -st["heroes"][s]["gold"])
    ranking = []
    for s in alive:
        if ranking and st["heroes"][ranking[-1][0]]["gold"] == st["heroes"][s]["gold"]:
            ranking[-1].append(s)
        else:
            ranking.append([s])
    return ranking + [[s] for s in reversed(out)]


def apply(st, seat, action, rng):
    if st["over"]:
        raise Illegal("This quest is over.")
    kind = action.get("type")
    if kind == "resign":
        ev = resign(st, seat)
        if not st["over"] and st["turn"] == seat:
            _next(st)
        return ev
    if seat != st["turn"]:
        raise Illegal("It isn't your turn.")
    h = st["heroes"][seat]
    events = []

    if kind == "potion":
        if not h["potions"]:
            raise Illegal("You have no potions.")
        if h["hp"] >= MAX_HP:
            raise Illegal("You're already at full health.")
        _drink(st, seat, events)
        return events                      # free action: still your turn

    if kind == "rest":
        if h["hp"] >= MAX_HP:
            raise Illegal("You're already at full health — roll!")
        heal = min(4, MAX_HP - h["hp"])
        h["hp"] += heal
        events.append({"type": "rest", "seat": seat, "heal": heal})
    elif kind == "roll":
        if h["pos"] == LAST:               # at the lair: battle the dragon
            events.append({"type": "roll", "seat": seat, "value": 0, "dragon": True})
            _fight(st, seat, LAST, rng, events)
        else:
            d = _d6(rng)
            events.append({"type": "roll", "seat": seat, "value": d})
            path = []
            for t in range(h["pos"] + 1, min(LAST, h["pos"] + d) + 1):
                path.append(t)
                if str(t) in st["monsters"]:
                    break
            frm = h["pos"]
            h["pos"] = path[-1]
            for t in path:                 # walking past a campfire still saves your progress
                if LAYOUT[t] == "camp":
                    h["camp"] = max(h["camp"], t)
            blocked = str(h["pos"]) in st["monsters"] and h["pos"] < frm + d
            events.append({"type": "walk", "seat": seat, "from": frm, "path": path,
                           "blocked": LAYOUT[h["pos"]] if blocked else None})
            _land(st, seat, h["pos"], rng, events)
    else:
        raise Illegal("Choose Roll, Rest or Potion.")

    st["moves"] += 1
    st["last"] = {"seat": seat, "type": kind}
    if any(e["type"] == "slay" for e in events):
        events.append(finish(st, _rank(st), "the dragon is slain",
                             [x["gold"] for x in st["heroes"]]))
        return events
    if st["moves"] >= MOVE_CAP:
        events.append(finish(st, _rank(st), "the night grew late",
                             [x["gold"] for x in st["heroes"]]))
        return events
    _next(st)
    return events


def public(st):
    dragon = st["monsters"].get(str(LAST))
    return {"heroes": st["heroes"], "monsters": st["monsters"], "layout": LAYOUT,
            "turn": st["turn"], "last": st["last"], "over": st["over"],
            "result": st["result"], "moves": st["moves"], "log": st["log"][-6:],
            "dragon": dragon, "maxHp": MAX_HP, "out": st.get("out", [])}


def private(st, seat):
    return None
