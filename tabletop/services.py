"""Game-night logic that both the views and the websocket consumer use.

Everything here is synchronous Django ORM code; the consumer wraps calls in
database_sync_to_async. Moves are applied inside a transaction with the
Match row locked, so two phones tapping at once can't both move.
"""

import math
import random
from datetime import timedelta

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from games.avatars import normalize_avatar_id

from .engines import ENGINES, Illegal, engine
from .models import GameNight, Match, Player

RNG = random.SystemRandom()

# Preferred table size for each game (min is always 2).
TABLE_SIZE = {"chess": 2, "dam": 2, "ludo": 4, "words": 3,
              "oware": 2, "four": 2, "snakes": 4, "quest": 4}
POINTS_2 = [3, 0]
POINTS_N = [3, 2, 1, 0]
DRAW_POINTS = 1
ONLINE_GRACE = timedelta(seconds=90)


# ───────────────────────────── payloads ─────────────────────────────

def player_card(p):
    return {
        "id": p.id, "name": p.name, "avatar": p.avatar_id, "points": p.points,
        "wins": p.wins, "draws": p.draws, "losses": p.losses, "played": p.played,
        "kills": p.kills, "online": p.online > 0, "benched": p.benched,
    }


def leaderboard(night):
    rows = [player_card(p) for p in night.players.filter(kicked=False)]
    rows.sort(key=lambda r: (-r["points"], -r["wins"], -r["kills"], r["name"].lower()))
    rank, prev = 0, None
    for i, r in enumerate(rows):
        key = (r["points"], r["wins"])
        if key != prev:
            rank = i + 1
            prev = key
        r["rank"] = rank
    return rows


def night_card(night):
    return {
        "id": str(night.id), "code": night.code, "title": night.title,
        "game": night.game, "state": night.state, "view": night.view,
        "pairing": night.pairing, "round": night.round,
        "check_words": night.check_words, "dam_size": night.dam_size,
        "featured": night.featured_id,
        "games": [{"key": k, **{x: m.META[x] for x in ("label", "emoji", "min", "max")}}
                  for k, m in ENGINES.items()],
    }


def match_payload(m, people=None):
    eng = engine(m.game)
    if people is None:
        people = {p.id: p for p in Player.objects.filter(id__in=m.seats)}
    seats = []
    for pid in m.seats:
        p = people.get(pid)
        seats.append({"id": pid, "name": p.name if p else "Gone",
                      "avatar": p.avatar_id if p else "ghost"})
    return {
        "id": m.id, "round": m.round, "table": m.table, "game": m.game,
        "status": m.status, "version": m.version, "seats": seats,
        "state": eng.public(m.state), "awarded": m.awarded,
    }


def visible_matches(night):
    """Active tables plus the ones that finished this round."""
    qs = night.matches.filter(round=night.round).exclude(status="void")
    return list(qs)


def snapshot(night, viewer=None):
    matches = visible_matches(night)
    people = {p.id: p for p in night.players.all()}
    data = {
        "t": "snapshot",
        "night": night_card(night),
        "players": leaderboard(night),
        "matches": [match_payload(m, people) for m in matches],
    }
    if viewer is not None:
        data["you"] = player_card(viewer)
        data["private"] = private_for(viewer, matches)
    return data


def private_for(player, matches):
    out = {}
    for m in matches:
        if m.status == "active" and player.id in m.seats:
            p = engine(m.game).private(m.state, m.seats.index(player.id))
            if p is not None:
                out[str(m.id)] = p
    return out


# ───────────────────────────── players ─────────────────────────────

def join(night, name, avatar_id):
    name = " ".join(str(name or "").split())[:40] or "Player"
    if night.players.filter(kicked=False).count() >= 80:
        raise ValueError("This game night is full.")
    taken = set(night.players.values_list("name", flat=True))
    base, n = name, 2
    while name in taken:
        suffix = f" {n}"
        name = base[: 40 - len(suffix)] + suffix
        n += 1
    return Player.objects.create(night=night, name=name,
                                 avatar_id=normalize_avatar_id(avatar_id))


def set_avatar(player, avatar_id):
    player.avatar_id = normalize_avatar_id(avatar_id)
    player.save(update_fields=["avatar_id", "last_seen"])
    return player


def touch_online(player_id, delta):
    Player.objects.filter(id=player_id).update(online=F("online") + delta,
                                               last_seen=timezone.now())
    Player.objects.filter(id=player_id, online__lt=0).update(online=0)


# ───────────────────────────── dealing ─────────────────────────────

def _split(n, size):
    """Split n players into tables of at most `size`, none smaller than 2."""
    if n < 2:
        return []
    if size == 2:
        return [2] * (n // 2)
    tables = math.ceil(n / size)
    base, extra = divmod(n, tables)
    sizes = [base + (1 if i < extra else 0) for i in range(tables)]
    return [s for s in sizes if s >= 2]


@transaction.atomic
def deal(night, game=None):
    """Seat every available player at a fresh table. Returns new matches.

    Players already playing an active match keep playing. Benched,
    kicked and long-offline players sit out. With "ranked" pairing the
    leaderboard is sliced top-down so leaders meet leaders.
    """
    night = GameNight.objects.select_for_update().get(pk=night.pk)
    if game and game in ENGINES:
        night.game = game
    busy = set()
    for m in night.matches.filter(status="active"):
        busy.update(m.seats)
    cutoff = timezone.now() - ONLINE_GRACE
    pool = [p for p in night.players.filter(kicked=False, benched=False)
            if p.id not in busy and (p.online > 0 or p.last_seen >= cutoff)]
    if night.pairing == "ranked":
        pool.sort(key=lambda p: (-p.points, -p.wins, RNG.random()))
    else:
        RNG.shuffle(pool)
        pool.sort(key=lambda p: p.played)   # whoever sat out last goes first
    sizes = _split(len(pool), TABLE_SIZE[night.game])
    if not sizes:
        return night, []
    night.round += 1
    night.state = "playing"
    eng = engine(night.game)
    created, i = [], 0
    for t, size in enumerate(sizes, start=1):
        seated = pool[i:i + size]
        i += size
        if night.pairing != "ranked":
            RNG.shuffle(seated)
        if night.game == "words":
            st = eng.new_game(size, RNG, check_words=night.check_words)
        elif night.game == "dam":
            st = eng.new_game(size, RNG, size=night.dam_size)
        else:
            st = eng.new_game(size, RNG)
        created.append(Match.objects.create(
            night=night, round=night.round, table=t, game=night.game,
            seats=[p.id for p in seated], state=st))
    night.featured = created[0]
    night.save()
    return night, created


@transaction.atomic
def end_round(night):
    """Stop every active table without awarding points."""
    night.matches.filter(status="active").update(status="void")
    night.state = "lobby"
    night.save(update_fields=["state", "updated_at"])


# ───────────────────────────── moves ─────────────────────────────

def points_for(ranking, n):
    table = POINTS_2 if n == 2 else POINTS_N
    out, pos = {}, 0
    for group in ranking:
        if len(group) == n and n > 1:          # everyone tied: a draw
            for s in group:
                out[s] = DRAW_POINTS
        else:
            for s in group:
                out[s] = table[pos] if pos < len(table) else 0
        pos += len(group)
    return out


def _kills_in(events, seat_of_attacker):
    k = 0
    for e in events:
        if e.get("type") == "capture":
            k += len(e.get("victims", [])) or 1
        elif e.get("type") == "jump":
            k += len(e.get("victims", []))
    return k


@transaction.atomic
def apply_action(match_id, player_id, action, as_seat=None):
    """Apply one action. Returns (match, events, awarded_or_None).

    `player_id` is the acting phone; the host passes `as_seat` instead to
    act for a seat (e.g. resign a player who walked away).
    """
    m = Match.objects.select_for_update().get(pk=match_id)
    if m.status != "active":
        raise Illegal("This table has finished.")
    if as_seat is not None:
        seat = int(as_seat)
        if not 0 <= seat < len(m.seats):
            raise Illegal("No such seat.")
    else:
        if player_id not in m.seats:
            raise Illegal("You're watching this table, not playing at it.")
        seat = m.seats.index(player_id)
    eng = engine(m.game)
    state = m.state
    events = eng.apply(state, seat, action, RNG)
    m.state = state
    m.version += 1
    awarded = None
    kills = _kills_in(events, seat)
    if kills:
        Player.objects.filter(id=m.seats[seat]).update(kills=F("kills") + kills)
    if state.get("over"):
        m.status = "done"
        awarded = _award(m)
    m.save()
    return m, events, awarded


def _award(m):
    res = m.state.get("result") or {}
    ranking = res.get("ranking") or []
    n = len(m.seats)
    pts = points_for(ranking, n)
    awarded = {}
    draw = len(ranking) == 1 and n > 1
    for seat, pid in enumerate(m.seats):
        p = pts.get(seat, 0)
        awarded[str(pid)] = p
        upd = {"points": F("points") + p, "played": F("played") + 1}
        if draw:
            upd["draws"] = F("draws") + 1
        elif ranking and seat in ranking[0]:
            upd["wins"] = F("wins") + 1
        else:
            upd["losses"] = F("losses") + 1
        Player.objects.filter(id=pid).update(**upd)
    m.awarded = awarded
    return awarded
