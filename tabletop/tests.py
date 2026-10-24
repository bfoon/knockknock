import random

from asgiref.sync import sync_to_async
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from django.contrib.auth import get_user_model
from django.test import TestCase, TransactionTestCase, override_settings
from django.urls import reverse

from games.avatars import is_valid_avatar_id, normalize_avatar_id, parse_hero_avatar

from . import services
from .engines import Illegal, chess, draughts, four, ludo, oware, quest, snakes, words
from .models import GameNight, Match, Player
from .routing import websocket_urlpatterns

MEMORY_LAYER = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}


# ─────────────────────────── engines ───────────────────────────

def _fen(fen):
    parts = fen.split()
    b = [""] * 64
    for ri, row in enumerate(parts[0].split("/")):
        r, c = 7 - ri, 0
        for ch in row:
            if ch.isdigit():
                for _ in range(int(ch)):
                    b[r * 8 + c] = "."
                    c += 1
            else:
                b[r * 8 + c] = ch
                c += 1
    st = chess.new_game()
    st.update(board="".join(b), side=parts[1], castle="" if parts[2] == "-" else parts[2],
              ep=-1 if parts[3] == "-" else chess.sq(parts[3]), turn=0 if parts[1] == "w" else 1)
    return st


def _perft(st, d):
    if d == 0:
        return 1
    n = 0
    for mv in chess.legal(st):
        nb, info = chess._make(st, mv)
        s2 = dict(st, board=nb, ep=info["ep_new"], side="b" if st["side"] == "w" else "w")
        c, p = st["castle"], info["piece"]
        if p == "K":
            c = c.replace("K", "").replace("Q", "")
        if p == "k":
            c = c.replace("k", "").replace("q", "")
        for corner, right in ((0, "Q"), (7, "K"), (56, "q"), (63, "k")):
            if corner in mv[:2]:
                c = c.replace(right, "")
        s2["castle"] = c
        n += _perft(s2, d - 1)
    return n


class ChessEngineTests(TestCase):
    def test_perft_reference_positions(self):
        self.assertEqual(_perft(chess.new_game(), 3), 8902)
        kiwi = _fen("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -")
        self.assertEqual(_perft(kiwi, 2), 2039)
        self.assertEqual(_perft(_fen("8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - -"), 3), 2812)

    def test_fools_mate_and_capture_events(self):
        st = chess.new_game()
        for i, m in enumerate(["f2f3", "e7e5", "g2g4"]):
            chess.apply(st, i % 2, {"move": m})
        ev = chess.apply(st, 1, {"move": "d8h4"})
        self.assertTrue(st["over"])
        self.assertEqual(st["result"]["ranking"], [[1], [0]])
        self.assertIn("check", [e["type"] for e in ev])

        st = chess.new_game()
        for i, m in enumerate(["e2e4", "d7d5"]):
            chess.apply(st, i % 2, {"move": m})
        ev = chess.apply(st, 0, {"move": "e4d5"})
        self.assertEqual(ev[0]["type"], "capture")
        self.assertEqual(ev[0]["victim"], "d5")
        with self.assertRaises(Illegal):
            chess.apply(st, 0, {"move": "a2a3"})  # not your turn


class DamEngineTests(TestCase):
    def test_majority_capture_is_compulsory(self):
        st = draughts.new_game()
        b = ["."] * 100
        for r, c, p in ((0, 0, "w"), (1, 1, "b"), (3, 3, "b"), (5, 5, "b"), (4, 0, "w"), (5, 1, "b"), (9, 9, "b")):
            b[r * 10 + c] = p
        st["board"] = "".join(b)
        legal = draughts.legal(st)
        self.assertTrue(legal and all(len(o["caps"]) == 3 for o in legal))
        with self.assertRaises(Illegal):
            draughts.apply(st, 0, {"path": [40, 51]})  # quiet move while a capture exists
        ev = draughts.apply(st, 0, {"path": legal[0]["path"]})
        self.assertEqual(ev[0]["type"], "jump")
        self.assertEqual(len(ev[0]["victims"]), 3)

    def test_flying_king(self):
        st = draughts.new_game()
        b = ["."] * 100
        b[0], b[44], b[99] = "W", "b", "b"
        st["board"] = "".join(b)
        self.assertTrue(all(o["caps"] == [44] for o in draughts.legal(st)))

    def test_random_games_terminate(self):
        for seed in range(10):
            r = random.Random(seed)
            st = draughts.new_game()
            while not st["over"]:
                o = r.choice(draughts.legal(st))
                draughts.apply(st, st["turn"], {"path": o["path"]}, r)


class LudoEngineTests(TestCase):
    def test_random_games_finish(self):
        for n in (2, 3, 4):
            r = random.Random(n)
            st = ludo.new_game(n, r)
            for _ in range(30000):
                if st["over"]:
                    break
                s = st["turn"]
                if st["phase"] == "roll":
                    ludo.apply(st, s, {"type": "roll"}, r)
                else:
                    ludo.apply(st, s, {"type": "move", "token": r.choice(st["movable"])}, r)
            self.assertTrue(st["over"])

    def test_capture_sends_home(self):
        r = random.Random(0)
        st = ludo.new_game(2, r)               # colours red(0) and yellow(2)
        st["tokens"][0][0] = 20                 # red on global 20
        st["tokens"][1][0] = (20 + 3 - 26) % 52 # yellow 3 ahead
        st["phase"], st["dice"], st["movable"] = "move", 3, [0]
        ev = ludo.apply(st, 0, {"type": "move", "token": 0}, r)
        self.assertIn("capture", [e["type"] for e in ev])
        self.assertEqual(st["tokens"][1][0], -1)
        self.assertEqual(st["phase"], "roll")   # bonus roll
        self.assertEqual(st["turn"], 0)


class WordsEngineTests(TestCase):
    def test_play_score_and_dictionary(self):
        r = random.Random(3)
        st = words.new_game(2, r)
        st["racks"][0] = list("CATSDOG")
        with self.assertRaises(Illegal):
            words.apply(st, 0, {"type": "play", "tiles": [{"r": 0, "c": 0, "l": "C"}, {"r": 0, "c": 1, "l": "A"}]}, r)
        ev = words.apply(st, 0, {"type": "play", "tiles": [
            {"r": 7, "c": 6, "l": "C"}, {"r": 7, "c": 7, "l": "A"}, {"r": 7, "c": 8, "l": "T"}]}, r)
        self.assertEqual(ev[0]["score"], 10)         # centre star doubles the word
        self.assertEqual(len(st["racks"][0]), 7)     # refilled
        st["racks"][1] = list("QZXJKVW")
        with self.assertRaises(Illegal):
            words.apply(st, 1, {"type": "play", "tiles": [{"r": 8, "c": 6, "l": "Q"}, {"r": 9, "c": 6, "l": "Z"}]}, r)

    def test_private_rack_not_in_public(self):
        st = words.new_game(2, random.Random(1))
        self.assertEqual(words.public(st)["racks"], [7, 7])   # counts only, never letters
        self.assertEqual(len(words.private(st, 0)["rack"]), 7)


class FixedRng:
    """Feeds scripted dice so adventure / snakes tests are deterministic."""
    def __init__(self, rolls):
        self.rolls = list(rolls)

    def randint(self, a, b):
        return self.rolls.pop(0)


class OwareTests(TestCase):
    def test_sow_and_capture_chain(self):
        st = oware.new_game()
        st["pits"] = [0, 0, 0, 0, 0, 3,   1, 2, 4, 4, 4, 4]
        # seat 0 sows pit 5: seeds land in 6, 7, 8 -> 8 has 5 (no capture)
        ev = oware.apply(st, 0, {"pit": 5})
        self.assertEqual(ev[0]["path"], [6, 7, 8])
        st = oware.new_game()
        st["pits"] = [0, 0, 0, 0, 0, 2,   1, 2, 4, 4, 4, 4]
        ev = oware.apply(st, 0, {"pit": 5})          # lands 6 (->2) and 7 (->3): capture both
        cap = [e for e in ev if e["type"] == "capture"][0]
        self.assertEqual((sorted(cap["pits"]), cap["count"]), ([6, 7], 5))
        self.assertEqual(st["store"][0], 5)

    def test_grand_slam_captures_nothing(self):
        st = oware.new_game()
        st["pits"] = [0, 0, 0, 0, 0, 2,   1, 1, 0, 0, 0, 0]
        ev = oware.apply(st, 0, {"pit": 5})
        self.assertIn("grandslam", [e["type"] for e in ev])
        self.assertEqual(st["store"][0], 0)

    def test_must_feed_an_empty_opponent(self):
        st = oware.new_game()
        st["pits"] = [1, 0, 0, 0, 0, 1,   0, 0, 0, 0, 0, 0]
        self.assertEqual(oware.legal(st), [5])      # only pit 5 reaches the other side
        with self.assertRaises(Illegal):
            oware.apply(st, 0, {"pit": 0})

    def test_seeds_are_conserved(self):
        r = random.Random(5)
        for seed in range(40):
            st, r = oware.new_game(), random.Random(seed)
            while not st["over"]:
                oware.apply(st, st["turn"], {"pit": r.choice(oware.legal(st))})
            self.assertEqual(sum(st["store"]) + sum(st["pits"]), 48)


class SnakesTests(TestCase):
    def test_ladder_snake_and_bounce(self):
        st = snakes.new_game(2)
        st["pos"][0] = 1
        ev = snakes.apply(st, 0, {"type": "roll"}, FixedRng([3]))     # 1 -> 4 -> ladder to 25
        self.assertIn("ladder", [e["type"] for e in ev])
        self.assertEqual(st["pos"][0], 25)
        st["pos"][1] = 24
        ev = snakes.apply(st, 1, {"type": "roll"}, FixedRng([3]))     # 24 -> 27 -> snake to 5
        self.assertIn("snake", [e["type"] for e in ev])
        self.assertEqual(st["pos"][1], 5)
        st["pos"][0] = 97
        ev = snakes.apply(st, 0, {"type": "roll"}, FixedRng([5]))     # 97 + 5 bounces back to 98
        self.assertTrue(ev[1]["bounce"])
        self.assertEqual(st["pos"][0], 98)

    def test_reaching_100_wins(self):
        st = snakes.new_game(3)
        st["pos"] = [95, 10, 20]
        ev = snakes.apply(st, 0, {"type": "roll"}, FixedRng([5]))
        self.assertTrue(st["over"])
        self.assertEqual(st["result"]["ranking"][0], [0])
        self.assertEqual(st["result"]["ranking"][1], [2])              # then by position


class FourTests(TestCase):
    def test_vertical_win_and_full_column(self):
        st = four.new_game()
        for i in range(3):
            four.apply(st, 0, {"col": 3}); four.apply(st, 1, {"col": 4})
        ev = four.apply(st, 0, {"col": 3})
        self.assertTrue(st["over"])
        self.assertEqual([e["type"] for e in ev][:2], ["drop", "line"])
        st = four.new_game()
        for i in range(6):
            four.apply(st, i % 2, {"col": 0})
        with self.assertRaises(Illegal):
            four.apply(st, 0, {"col": 0})


class QuestTests(TestCase):
    def test_monster_blocks_and_is_slain(self):
        st = quest.new_game(2)
        # roll 4 from 0: tile 2 holds a slime, so the hero stops there and fights
        ev = quest.apply(st, 0, {"type": "roll"}, FixedRng([4, 6]))
        walk = [e for e in ev if e["type"] == "walk"][0]
        self.assertEqual((walk["path"], walk["blocked"]), ([1, 2], "slime"))
        fight = [e for e in ev if e["type"] == "fight"][0]
        self.assertEqual(fight["result"], "win")
        self.assertNotIn("2", st["monsters"])
        self.assertEqual(st["heroes"][0]["gold"], 2)

    def test_knockout_sends_you_to_camp_and_costs_gold(self):
        st = quest.new_game(2)
        h = st["heroes"][1]
        h.update(pos=15, hp=1, gold=10, camp=14)
        st["turn"] = 1
        # roll 1 -> skeleton on 16; hero misses (1), skeleton hits (6) -> KO
        ev = quest.apply(st, 1, {"type": "roll"}, FixedRng([1, 1, 6]))
        self.assertIn("ko", [e["type"] for e in ev])
        self.assertEqual((h["pos"], h["hp"], h["gold"]), (14, quest.MAX_HP, 5))

    def test_potion_is_a_free_action_and_rest_heals(self):
        st = quest.new_game(2)
        st["heroes"][0]["hp"] = 4
        quest.apply(st, 0, {"type": "potion"}, FixedRng([]))
        self.assertEqual((st["heroes"][0]["hp"], st["turn"]), (9, 0))   # still your turn
        quest.apply(st, 0, {"type": "rest"}, FixedRng([]))
        self.assertEqual((st["heroes"][0]["hp"], st["turn"]), (10, 1))
        with self.assertRaises(Illegal):
            quest.apply(st, 1, {"type": "rest"}, FixedRng([]))           # already full

    def test_final_blow_on_the_dragon_ends_the_quest(self):
        st = quest.new_game(2)
        st["heroes"][0].update(pos=quest.LAST, gold=4)
        st["heroes"][1]["gold"] = 30
        st["monsters"][str(quest.LAST)]["hp"] = 1
        ev = quest.apply(st, 0, {"type": "roll"}, FixedRng([6]))
        self.assertIn("slay", [e["type"] for e in ev])
        self.assertTrue(st["over"])
        self.assertEqual(st["heroes"][0]["gold"], 29)
        self.assertEqual(st["result"]["ranking"][0], [1])                # still ranked by gold

    def test_random_quests_finish(self):
        for seed in range(25):
            r = random.Random(seed)
            st = quest.new_game(4, r)
            while not st["over"]:
                quest.apply(st, st["turn"], {"type": "roll"}, r)


class HeroAvatarTests(TestCase):
    def test_hero_ids(self):
        self.assertTrue(is_valid_avatar_id("kh-0350241520"))
        self.assertEqual(parse_hero_avatar("kh-0350241520")["outfit"], 4)
        self.assertFalse(is_valid_avatar_id("kh-z350241520"))     # body only has 4 options
        self.assertEqual(normalize_avatar_id("kh-bad"), "dragon")
        self.assertLessEqual(len("kh-0350241520"), 30)             # fits Participant.avatar_id


# ─────────────────────────── services & views ───────────────────────────

class ServiceTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user("host", password="pw-pw-pw-123")
        self.night = GameNight.objects.create(owner=self.user, title="Friday", game="chess")

    def _players(self, n):
        return [services.join(self.night, f"P{i}", "kh-0350241520") for i in range(n)]

    def test_deal_pairs_and_benches_odd_player(self):
        self._players(5)
        night, created = services.deal(self.night)
        self.assertEqual(len(created), 2)
        self.assertEqual(night.round, 1)
        seated = {pid for m in created for pid in m.seats}
        self.assertEqual(len(seated), 4)

    def test_ludo_tables_split_evenly(self):
        self._players(7)
        night, created = services.deal(self.night, "ludo")
        self.assertEqual(sorted(len(m.seats) for m in created), [3, 4])

    def test_win_awards_points(self):
        a, b = self._players(2)
        night, (m,) = services.deal(self.night)
        white = Player.objects.get(pk=m.seats[0])
        black = Player.objects.get(pk=m.seats[1])
        for pid, mv in ((white.id, "f2f3"), (black.id, "e7e5"), (white.id, "g2g4"), (black.id, "d8h4")):
            m, events, awarded = services.apply_action(m.id, pid, {"move": mv})
        self.assertEqual(m.status, "done")
        black.refresh_from_db()
        white.refresh_from_db()
        self.assertEqual((black.points, black.wins), (3, 1))
        self.assertEqual((white.points, white.losses), (0, 1))
        board = services.leaderboard(self.night)
        self.assertEqual(board[0]["id"], black.id)

    def test_spectator_cannot_move(self):
        self._players(3)
        night, (m,) = services.deal(self.night)
        outsider = Player.objects.exclude(id__in=m.seats).get()
        with self.assertRaises(Illegal):
            services.apply_action(m.id, outsider.id, {"move": "e2e4"})

    def test_new_games_deal_tables(self):
        self._players(5)
        for game, sizes in (("oware", [2, 2]), ("four", [2, 2]), ("snakes", [2, 3]), ("quest", [2, 3])):
            Match.objects.filter(night=self.night).update(status="void")
            night, created = services.deal(self.night, game)
            self.assertEqual(sorted(len(m.seats) for m in created), sizes, game)
            self.assertTrue(all(m.game == game for m in created))

    def test_duplicate_names_get_numbers(self):
        a = services.join(self.night, "Ama", "dragon")
        b = services.join(self.night, "Ama", "dragon")
        self.assertNotEqual(a.name, b.name)

    def test_points_for_rankings(self):
        self.assertEqual(services.points_for([[0, 1]], 2), {0: 1, 1: 1})
        self.assertEqual(services.points_for([[2], [0], [1], [3]], 4), {2: 3, 0: 2, 1: 1, 3: 0})


@override_settings(STATICFILES_STORAGE="django.contrib.staticfiles.storage.StaticFilesStorage")
class ViewTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user("host2", password="pw-pw-pw-123")
        self.night = GameNight.objects.create(owner=self.user, title="Office")

    def test_join_flow_sets_cookie_and_opens_phone(self):
        r = self.client.post(reverse("tabletop:join_code", args=[self.night.code]),
                             {"code": self.night.code, "name": "Lamin", "avatar_id": "kh-0350241520"})
        self.assertRedirects(r, reverse("tabletop:play", args=[self.night.code]), fetch_redirect_response=False)
        self.assertIn(f"tt_{self.night.code}", r.cookies)
        p = Player.objects.get(night=self.night)
        self.assertEqual(p.avatar_id, "kh-0350241520")
        r = self.client.get(reverse("tabletop:play", args=[self.night.code]))
        self.assertContains(r, p.token)

    def test_stage_requires_owner(self):
        url = reverse("tabletop:stage", args=[self.night.pk])
        self.assertEqual(self.client.get(url).status_code, 302)
        other = get_user_model().objects.create_user("x", password="pw-pw-pw-123")
        self.client.force_login(other)
        self.assertEqual(self.client.get(url).status_code, 404)
        self.client.force_login(self.user)
        r = self.client.get(url)
        self.assertContains(r, self.night.pretty_code)

    def test_list_creates_night(self):
        self.client.force_login(self.user)
        r = self.client.post(reverse("tabletop:list"), {"title": "Ludo party", "game": "ludo"})
        night = GameNight.objects.get(title="Ludo party")
        self.assertEqual(night.game, "ludo")
        self.assertRedirects(r, reverse("tabletop:stage", args=[night.pk]), fetch_redirect_response=False)


# ─────────────────────────── websocket, end to end ───────────────────────────

@override_settings(CHANNEL_LAYERS=MEMORY_LAYER)
class ConsumerTests(TransactionTestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user("wshost", password="pw-pw-pw-123")
        self.night = GameNight.objects.create(owner=self.user, title="WS", game="chess")
        self.app = URLRouter(websocket_urlpatterns)

    async def _sock(self, role, token="", user=None):
        c = WebsocketCommunicator(self.app, f"/ws/tabletop/{self.night.code}/")
        if user is not None:
            c.scope["user"] = user
        ok, _ = await c.connect()
        assert ok
        await c.send_json_to({"t": "hello", "role": role, "token": token})
        return c

    async def _until(self, c, t, limit=20):
        for _ in range(limit):
            m = await c.receive_json_from(timeout=3)
            if m.get("t") == t:
                return m
        raise AssertionError(f"never got {t}")

    async def test_full_round_over_websockets(self):
        p1 = await sync_to_async(services.join)(self.night, "Awa", "dragon")
        p2 = await sync_to_async(services.join)(self.night, "Musa", "kh-0350241520")

        stage = await self._sock("stage", user=self.user)
        snap = await self._until(stage, "snapshot")
        self.assertEqual(snap["night"]["code"], self.night.code)

        a = await self._sock("player", p1.token)
        b = await self._sock("player", p2.token)
        await self._until(a, "snapshot")
        await self._until(b, "snapshot")

        await stage.send_json_to({"t": "host", "act": "deal", "game": "chess"})
        await self._until(a, "resync")
        await a.send_json_to({"t": "sync"})
        snap = await self._until(a, "snapshot")
        m = snap["matches"][0]
        white = p1 if m["seats"][0]["id"] == p1.id else p2
        black = p2 if white is p1 else p1
        socks = {p1.id: a, p2.id: b}

        moves = [(white, "f2f3"), (black, "e7e5"), (white, "g2g4"), (black, "d8h4")]
        for who, mv in moves:
            await socks[who.id].send_json_to({"t": "move", "match": m["id"], "action": {"type": "move", "move": mv}})
            upd = await self._until(stage, "match")
            self.assertEqual(upd["match"]["state"]["last"], [mv[:2], mv[2:4]])
        self.assertEqual(upd["match"]["status"], "done")
        self.assertEqual(upd["awarded"][str(black.id)], 3)
        board = await self._until(stage, "players")
        self.assertEqual(board["players"][0]["id"], black.id)

        # wrong player / bad move -> error only to that phone
        await a.send_json_to({"t": "move", "match": m["id"], "action": {"type": "move", "move": "a2a3"}})
        err = await self._until(a, "error")
        self.assertIn("finished", err["msg"])

        for c in (stage, a, b):
            await c.disconnect()

    async def test_reactions_reach_stage_with_sender_and_are_rate_limited(self):
        p1 = await sync_to_async(services.join)(self.night, "Awa", "dragon")
        stage = await self._sock("stage", user=self.user)
        await self._until(stage, "snapshot")
        a = await self._sock("player", p1.token)
        await self._until(a, "snapshot")
        await self._until(stage, "players")
        for _ in range(3):                        # a burst faster than the cooldown
            await a.send_json_to({"t": "react", "emoji": "🔥"})
        r = await self._until(stage, "react")
        self.assertEqual((r["player"], r["emoji"]), (p1.id, "🔥"))
        self.assertTrue(await stage.receive_nothing(timeout=0.3))   # the rest were dropped
        await a.send_json_to({"t": "react", "emoji": "not-allowed"})
        self.assertTrue(await stage.receive_nothing(timeout=0.3))
        await stage.disconnect()
        await a.disconnect()

    async def test_stage_needs_owner_and_bad_token_denied(self):
        c = await self._sock("stage")  # anonymous
        self.assertEqual((await c.receive_json_from())["t"], "denied")
        c2 = await self._sock("player", "nope")
        self.assertEqual((await c2.receive_json_from())["t"], "denied")

    async def test_scramble_rack_stays_private(self):
        await sync_to_async(self._words_night)()
        p1 = await sync_to_async(services.join)(self.night, "A", "dragon")
        p2 = await sync_to_async(services.join)(self.night, "B", "dragon")
        await sync_to_async(services.deal)(self.night, "words")
        a = await self._sock("player", p1.token)
        watch = await self._sock("watch")
        snap_a = await self._until(a, "snapshot")
        snap_w = await self._until(watch, "snapshot")
        self.assertEqual(len(list(snap_a["private"].values())[0]["rack"]), 7)
        self.assertNotIn("private", snap_w)
        self.assertNotIn("racks\": [[", str(snap_w))
        await a.disconnect()
        await watch.disconnect()

    def _words_night(self):
        self.night.game = "words"
        self.night.save()
