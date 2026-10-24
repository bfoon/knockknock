"""Live Tables realtime channel: ws/tabletop/<code>/

Every frame is {"t": "<type>", ...}.

  client -> server                          server -> client(s)
  ---------------------------------------   ---------------------------------
  hello {role: stage|player|watch, token}   snapshot {night, players, matches,
                                                      you?, private?}
  move  {match, action}        (player)     match   {match, events, by}
  avatar {avatar}              (player)     players {players}
  react {emoji}                (player)     react   {player, emoji}
  ping                                      pong
  host  {act, ...}             (stage)      night   {night}
        act = deal {game} | end_round |     private {match, data} (to one seat)
              feature {match} | view {view} error   {msg}
              | game {game} | pairing {...} toast   {msg}
              | words_check {on} | dam_size
              | bench {player} | kick {player}
              | resign_for {match, seat}
              | reset_scores

Only the stage (the night's owner, signed in) can send host commands.
Phones identify with the token they got when they joined. Watchers (no
token) get the public picture only — handy for spectators' phones.

Private data (Scramble racks) never goes to the room group: after each
move the consumer pushes it to the seated players' personal groups.
"""

import time

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from . import services
from .engines import ENGINES, Illegal, engine
from .models import GameNight, Match, Player

REACTIONS = {"👏", "🔥", "😂", "😱", "🤯", "👑", "💀", "🎉", "😎", "🙏"}
MAX_MSGS_PER_SEC = 12


def room(code):
    return f"tt.{code}"


def seat_group(code, pid):
    return f"tt.{code}.p{pid}"


class TabletopConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        self.code = self.scope["url_route"]["kwargs"]["code"]
        self.role = None
        self.player_id = None
        self.night_id = None
        self._bucket = []
        await self.accept()

    async def disconnect(self, close_code):
        if self.role:
            await self.channel_layer.group_discard(room(self.code), self.channel_name)
        if self.player_id:
            await self.channel_layer.group_discard(seat_group(self.code, self.player_id), self.channel_name)
            await database_sync_to_async(services.touch_online)(self.player_id, -1)
            await self._push_players()

    # ───────────────────────── plumbing ─────────────────────────
    def _throttled(self):
        now = time.monotonic()
        self._bucket = [t for t in self._bucket if now - t < 1.0]
        self._bucket.append(now)
        return len(self._bucket) > MAX_MSGS_PER_SEC

    async def error(self, msg):
        await self.send_json({"t": "error", "msg": str(msg)})

    async def receive_json(self, msg, **kwargs):
        if not isinstance(msg, dict):
            return
        if self._throttled():
            return
        t = msg.get("t")
        if t == "ping":
            await self.send_json({"t": "pong"})
            return
        if t == "hello":
            await self.hello(msg)
            return
        if not self.role:
            await self.error("Say hello first.")
            return
        if t == "sync":
            await self.send_json(await self._snapshot())
            return
        try:
            if t == "move" and self.role == "player":
                await self.move(msg)
            elif t == "avatar" and self.role == "player":
                await self.avatar(msg)
            elif t == "react" and self.role == "player":
                await self.react(msg)
            elif t == "host" and self.role == "stage":
                await self.host(msg)
        except Illegal as e:
            await self.error(e)

    # group fan-out handlers
    async def tt_send(self, event):
        await self.send_json(event["data"])

    async def tt_kick(self, event):
        await self.send_json({"t": "kicked"})
        await self.close()

    async def broadcast(self, data):
        await self.channel_layer.group_send(room(self.code), {"type": "tt.send", "data": data})

    # ───────────────────────── hello ─────────────────────────
    async def hello(self, msg):
        role = msg.get("role")
        result = await self._auth(role, str(msg.get("token") or ""))
        if result is None:
            await self.send_json({"t": "denied"})
            await self.close()
            return
        self.role, self.night_id, self.player_id = result
        await self.channel_layer.group_add(room(self.code), self.channel_name)
        if self.player_id:
            await self.channel_layer.group_add(seat_group(self.code, self.player_id), self.channel_name)
            await database_sync_to_async(services.touch_online)(self.player_id, +1)
        await self.send_json(await self._snapshot())
        if self.player_id:
            await self._push_players()

    @database_sync_to_async
    def _auth(self, role, token):
        night = GameNight.objects.filter(code=self.code).first()
        if not night:
            return None
        if role == "stage":
            user = self.scope.get("user")
            if user and user.is_authenticated and user.id == night.owner_id:
                return ("stage", night.id, None)
            return None
        if role == "player":
            p = Player.objects.filter(night=night, token=token, kicked=False).first()
            return ("player", night.id, p.id) if p else None
        if role == "watch":
            return ("watch", night.id, None)
        return None

    @database_sync_to_async
    def _snapshot(self):
        night = GameNight.objects.get(pk=self.night_id)
        viewer = Player.objects.filter(pk=self.player_id).first() if self.player_id else None
        return services.snapshot(night, viewer)

    @database_sync_to_async
    def _players(self):
        night = GameNight.objects.get(pk=self.night_id)
        return services.leaderboard(night)

    async def _push_players(self):
        await self.broadcast({"t": "players", "players": await self._players()})

    @database_sync_to_async
    def _night(self):
        return services.night_card(GameNight.objects.get(pk=self.night_id))

    async def _push_night(self):
        await self.broadcast({"t": "night", "night": await self._night()})

    # ───────────────────────── player actions ─────────────────────────
    async def move(self, msg):
        try:
            match_id = int(msg.get("match"))
        except (TypeError, ValueError):
            raise Illegal("Which table?")
        action = msg.get("action") or {}
        if not isinstance(action, dict):
            raise Illegal("Bad move.")
        await self._apply(match_id, self.player_id, action, None)

    async def _apply(self, match_id, player_id, action, as_seat):
        ok = await database_sync_to_async(self._belongs)(match_id)
        if not ok:
            raise Illegal("That table isn't in this game night.")
        m, events, awarded, payload, privates, round_over = await database_sync_to_async(
            self._do_apply)(match_id, player_id, action, as_seat)
        await self.broadcast({"t": "match", "match": payload, "events": events,
                              "by": player_id, "awarded": awarded})
        for pid, data in privates.items():
            await self.channel_layer.group_send(seat_group(self.code, pid), {
                "type": "tt.send", "data": {"t": "private", "match": m.id, "data": data}})
        if awarded or any(e.get("type") in ("capture", "jump") for e in events):
            await self._push_players()
        if round_over:
            await self._push_night()
            await self.broadcast({"t": "toast", "msg": "Round complete — check the leaderboard!"})

    def _belongs(self, match_id):
        return Match.objects.filter(pk=match_id, night_id=self.night_id).exists()

    def _do_apply(self, match_id, player_id, action, as_seat):
        m, events, awarded = services.apply_action(match_id, player_id, action, as_seat)
        payload = services.match_payload(m)
        eng = engine(m.game)
        privates = {}
        for seat, pid in enumerate(m.seats):
            pv = eng.private(m.state, seat)
            if pv is not None:
                privates[pid] = pv
        round_over = False
        if m.status != "active":
            night = GameNight.objects.get(pk=self.night_id)
            if not night.matches.filter(status="active").exists():
                night.state = "lobby"
                night.save(update_fields=["state", "updated_at"])
                round_over = True
        return m, events, awarded, payload, privates, round_over

    async def avatar(self, msg):
        await database_sync_to_async(self._set_avatar)(msg.get("avatar"))
        await self._push_players()
        # seats in live matches show avatars too: resend those matches
        for payload in await database_sync_to_async(self._my_matches)():
            await self.broadcast({"t": "match", "match": payload, "events": [], "by": None})

    def _set_avatar(self, avatar):
        p = Player.objects.get(pk=self.player_id)
        services.set_avatar(p, avatar)

    def _my_matches(self):
        night = GameNight.objects.get(pk=self.night_id)
        return [services.match_payload(m) for m in night.matches.filter(status="active")
                if self.player_id in m.seats]

    async def react(self, msg):
        emoji = str(msg.get("emoji") or "")
        if emoji not in REACTIONS:
            return
        await self.broadcast({"t": "react", "player": self.player_id, "emoji": emoji})

    # ───────────────────────── host actions ─────────────────────────
    async def host(self, msg):
        act = msg.get("act")
        if act == "deal":
            created = await database_sync_to_async(self._deal)(msg.get("game"))
            if not created:
                await self.error("Need at least two players online to deal a table.")
                return
            await self._resync_all()
            await self.broadcast({"t": "toast", "msg": "New round — find your table!"})
        elif act == "end_round":
            await database_sync_to_async(self._end_round)()
            await self._resync_all()
        elif act == "resign_for":
            await self._apply(int(msg.get("match")), None, {"type": "resign"}, int(msg.get("seat")))
        elif act == "kick":
            pid = await database_sync_to_async(self._kick)(msg.get("player"))
            if pid:
                await self.channel_layer.group_send(seat_group(self.code, pid), {"type": "tt.kick"})
                await self._push_players()
        elif act == "bench":
            await database_sync_to_async(self._bench)(msg.get("player"))
            await self._push_players()
        elif act == "reset_scores":
            await database_sync_to_async(self._reset_scores)()
            await self._push_players()
        else:
            changed = await database_sync_to_async(self._setting)(act, msg)
            if changed:
                await self._push_night()

    def _deal(self, game):
        night = GameNight.objects.get(pk=self.night_id)
        night, created = services.deal(night, game)
        return created

    def _end_round(self):
        services.end_round(GameNight.objects.get(pk=self.night_id))

    def _kick(self, pid):
        n = Player.objects.filter(pk=pid, night_id=self.night_id).update(kicked=True, online=0)
        return int(pid) if n else None

    def _bench(self, pid):
        p = Player.objects.filter(pk=pid, night_id=self.night_id).first()
        if p:
            p.benched = not p.benched
            p.save(update_fields=["benched"])

    def _reset_scores(self):
        Player.objects.filter(night_id=self.night_id).update(
            points=0, wins=0, draws=0, losses=0, played=0, kills=0)

    def _setting(self, act, msg):
        night = GameNight.objects.get(pk=self.night_id)
        if act == "feature":
            m = Match.objects.filter(pk=msg.get("match"), night=night).first()
            night.featured = m
        elif act == "view" and msg.get("view") in dict(GameNight.VIEW_CHOICES):
            night.view = msg["view"]
        elif act == "game" and msg.get("game") in ENGINES:
            night.game = msg["game"]
        elif act == "pairing" and msg.get("pairing") in dict(GameNight.PAIRING_CHOICES):
            night.pairing = msg["pairing"]
        elif act == "words_check":
            night.check_words = bool(msg.get("on"))
        elif act == "dam_size" and msg.get("size") in (8, 10):
            night.dam_size = msg["size"]
        else:
            return False
        night.save()
        return True

    async def _resync_all(self):
        """After a deal or reset everyone re-reads the full picture.

        Phones need their private racks, so each socket rebuilds its own
        snapshot instead of receiving one shared blob.
        """
        await self.broadcast({"t": "resync"})
