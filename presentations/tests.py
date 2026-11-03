"""
Live sessions on a weak network, and "Play again" on the same code.

The network tests connect a presenter and several phones over real
WebSockets (channels' WebsocketCommunicator) and check the things that
made a 34-player game unplayable on EDGE: a double tap skipping a
question, every reconnect re-rendering everyone's screen, and the answer
reveal being broadcast once per phone instead of once.
"""
import asyncio
import json
import time

from asgiref.sync import sync_to_async
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, TransactionTestCase, override_settings

from games.models import GameChoice, GameQuestion, Quiz
from polls.models import Choice, Question, Questionnaire
from presentations.models import LiveSession, Participant, SessionRound
from presentations.routing import websocket_urlpatterns

IN_MEMORY = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
LOCMEM = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
PLAIN_STATIC = {"default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
                "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"}}


def make_quiz(owner, n=4, time_limit=20):
    quiz = Quiz.objects.create(owner=owner, title="Quiz")
    for i in range(n):
        q = GameQuestion.objects.create(quiz=quiz, text=f"Q{i + 1}", order=i, time_limit=time_limit)
        GameChoice.objects.create(question=q, text="right", is_correct=True, order=0)
        GameChoice.objects.create(question=q, text="wrong", order=1)
    return quiz


async def drain(comm, seconds=0.3):
    """Collect messages without cancelling the connection on timeout."""
    out, end = [], time.monotonic() + seconds
    while (left := end - time.monotonic()) > 0:
        try:
            frame = await asyncio.wait_for(comm.output_queue.get(), left)
        except asyncio.TimeoutError:
            break
        if frame.get("type") == "websocket.send" and frame.get("text"):
            out.append(json.loads(frame["text"]))
        elif frame.get("type") == "websocket.close":
            out.append({"type": "__closed__", "code": frame.get("code")})
    return out


def last_state(msgs):
    return [m for m in msgs if m.get("type") == "state"][-1]


@override_settings(CHANNEL_LAYERS=IN_MEMORY, CACHES=LOCMEM)
class WeakNetworkTests(TransactionTestCase):
    def setUp(self):
        cache.clear()
        self.owner = get_user_model().objects.create_user("host", password="pw-pw-pw-123")
        self.quiz = make_quiz(self.owner, time_limit=1)
        self.session = LiveSession.objects.create(owner=self.owner, kind="game", quiz=self.quiz)
        self.path = f"/ws/session/{self.session.code}/"

    async def connect(self, user=None, **hello):
        c = WebsocketCommunicator(URLRouter(websocket_urlpatterns), self.path)
        c.scope["user"] = user
        ok, _ = await c.connect()
        self.assertTrue(ok)
        if hello:
            await c.send_json_to({"type": "hello", **hello})
        return c

    async def presenter(self):
        return await self.connect(self.owner, role="presenter", uid="presenter-1")

    async def phone(self, i):
        return await self.connect(None, role="participant", uid=f"p{i}", nickname=f"Player {i}", avatar_id="dragon")

    async def index(self):
        s = await sync_to_async(LiveSession.objects.get)(pk=self.session.pk)
        return s.state, s.current_question_index

    async def test_double_tap_next_moves_once(self):
        host = await self.presenter()
        await drain(host)
        await host.send_json_to({"type": "advance"})
        start = last_state(await drain(host, 0.5))
        self.assertEqual(start["index"], 0)
        # Two taps sent before any reply — both carry the screen they were pressed on.
        await host.send_json_to({"type": "advance", "from_key": start["nav_key"]})
        await host.send_json_to({"type": "advance", "from_key": start["nav_key"]})
        msgs = await drain(host, 0.6)
        self.assertEqual(await self.index(), ("running", 1))
        results = [m for m in msgs if m.get("type") == "nav_result"]
        self.assertEqual([r["applied"] for r in results], [True, False])
        await host.disconnect()

    async def test_double_back_on_first_question_does_not_restart_the_timer(self):
        host = await self.presenter()
        await drain(host)
        await host.send_json_to({"type": "advance"})
        start = last_state(await drain(host, 0.5))
        await host.send_json_to({"type": "back", "from_key": start["nav_key"]})
        result = [m for m in await drain(host, 0.5) if m.get("type") == "nav_result"][0]
        self.assertFalse(result["applied"])
        self.assertEqual(result["nav_key"], start["nav_key"])
        await host.disconnect()

    async def test_taps_without_a_key_are_guarded_against_repeats(self):
        # Older pages / the big-screen driver don't send from_key.
        host = await self.presenter()
        await drain(host)
        await host.send_json_to({"type": "advance"})
        await drain(host, 0.3)
        await asyncio.sleep(0.7)                       # the start tap is well in the past
        for _ in range(4):                             # a held key: one move, not four
            await host.send_json_to({"type": "advance"})
        await drain(host, 0.4)
        self.assertEqual(await self.index(), ("running", 1))
        await asyncio.sleep(0.7)                       # a deliberate second tap later still works
        await host.send_json_to({"type": "advance"})
        await drain(host, 0.4)
        self.assertEqual(await self.index(), ("running", 2))
        await host.disconnect()

    async def test_reconnect_with_nothing_new_disturbs_nobody(self):
        host = await self.presenter()
        phones = [await self.phone(i) for i in range(4)]
        await asyncio.sleep(2)                         # let the join leaderboard flush
        for c in [host] + phones:
            await drain(c, 0.2)
        await phones[0].disconnect()
        phones[0] = await self.phone(0)
        own = await drain(phones[0], 0.5)
        self.assertEqual(last_state(own)["state"], "lobby")   # it gets its own state back
        for c in [host] + phones[1:]:
            self.assertEqual(await drain(c, 0.5), [])
        for c in [host] + phones:
            await c.disconnect()

    async def test_a_new_player_updates_the_host_not_every_phone(self):
        host = await self.presenter()
        first = await self.phone(0)
        await asyncio.sleep(2)
        await drain(host, 0.2)
        await drain(first, 0.2)
        newcomer = await self.phone(1)
        host_msgs = await drain(host, 0.4)
        self.assertEqual(last_state(host_msgs)["participants"], 2)
        self.assertNotIn("state", [m["type"] for m in await drain(first, 0.4)])
        # Phones still hear about the crowd, via one coalesced leaderboard.
        later = await drain(first, 2.0)
        self.assertEqual([m["type"] for m in later], ["leaderboard"])
        self.assertEqual(len(later[0]["data"]["rows"]), 2)
        for c in (host, first, newcomer):
            await c.disconnect()

    async def test_answer_reveal_reaches_each_screen_once(self):
        host = await self.presenter()
        phones = [await self.phone(i) for i in range(6)]
        await asyncio.sleep(0.3)
        await host.send_json_to({"type": "advance"})
        await asyncio.sleep(1.4)                       # time_limit=1: the timer has run out
        for c in [host] + phones:
            await drain(c, 0.1)
        for c in phones:                               # every phone asks…
            await c.send_json_to({"type": "reveal_answer"})
        await host.send_json_to({"type": "reveal_answer"})
        await asyncio.sleep(0.5)
        for c in phones:                               # …and retries, like play.js does
            await c.send_json_to({"type": "reveal_answer"})
        for c in [host] + phones:
            reveals = [m for m in await drain(c, 0.8) if m.get("type") == "correct_answer"]
            self.assertEqual(len(reveals), 1)
        for c in [host] + phones:
            await c.disconnect()

    async def test_answers_produce_one_coalesced_leaderboard(self):
        await sync_to_async(GameQuestion.objects.filter(quiz=self.quiz).update)(time_limit=30)
        host = await self.presenter()
        phones = [await self.phone(i) for i in range(5)]
        await host.send_json_to({"type": "advance"})
        await asyncio.sleep(2)
        state = last_state(await drain(phones[0], 0.2))
        for c in [host] + phones[1:]:
            await drain(c, 0.1)
        right = [c["id"] for c in state["question"]["choices"] if c["text"] == "right"][0] \
            if "choices" in state["question"] else None
        for c in phones:
            await c.send_json_to({"type": "answer", "question_id": state["question"]["id"],
                                  "choice_id": right})
        msgs = await drain(phones[1], 2.2)
        self.assertEqual(sum(1 for m in msgs if m["type"] == "leaderboard"), 1)
        for c in [host] + phones:
            await c.disconnect()


@override_settings(CHANNEL_LAYERS=IN_MEMORY, CACHES=LOCMEM, STORAGES=PLAIN_STATIC)
class PlayAgainTests(TestCase):
    def setUp(self):
        self.owner = get_user_model().objects.create_user("host", password="pw-pw-pw-123")
        self.client.force_login(self.owner)
        self.quiz = make_quiz(self.owner)
        self.session = LiveSession.objects.create(owner=self.owner, kind="game", quiz=self.quiz,
                                                  state="ended", current_question_index=3)
        for i in range(3):
            Participant.objects.create(session=self.session, participant_uid=f"p{i}",
                                       nickname=f"P{i}", score=(i + 1) * 100)
        self.code = self.session.code

    def play_again(self, session=None):
        s = session or self.session
        return self.client.post(f"/live/present/{s.code}/replay/", {"how": "restart"})

    def test_same_code_fresh_start_and_earlier_round_kept(self):
        r = self.play_again()
        self.assertRedirects(r, f"/live/present/{self.code}/", fetch_redirect_response=False)
        fresh = LiveSession.objects.get(code=self.code)
        self.assertNotEqual(fresh.pk, self.session.pk)
        self.assertEqual((fresh.state, fresh.current_question_index, fresh.participants.count()),
                         ("lobby", -1, 0))
        self.assertEqual(fresh.quiz, self.quiz)
        self.session.refresh_from_db()
        self.assertNotEqual(self.session.code, self.code)
        self.assertEqual(self.session.state, "ended")
        self.assertEqual(sorted(self.session.participants.values_list("score", flat=True)), [100, 200, 300])
        self.assertEqual(SessionRound.objects.get(session=self.session).played_code, self.code)

    def test_join_link_and_presenter_use_the_same_code(self):
        self.play_again()
        self.assertEqual(self.client.get(f"/live/join/{self.code}/").status_code, 200)
        page = self.client.get(f"/live/present/{self.code}/").content.decode()
        self.assertIn("Round 2", page)
        self.assertIn("Play again on", page)

    def test_play_again_from_an_earlier_round_reuses_the_played_code(self):
        self.play_again()
        earlier = LiveSession.objects.get(pk=self.session.pk)      # now on an internal code
        self.play_again(earlier)                                   # "Play again" on round 1's row
        self.assertTrue(LiveSession.objects.filter(code=self.code, state="lobby").exists())
        self.assertEqual(SessionRound.objects.filter(played_code=self.code).count(), 2)

    def test_open_round_is_ended_when_replaced(self):
        self.session.state = "running"
        self.session.save()
        self.play_again()
        self.session.refresh_from_db()
        self.assertEqual(self.session.state, "ended")
        self.assertIsNotNone(self.session.ended_at)

    def test_results_page_labels_rounds_and_offers_play_again(self):
        self.play_again()
        html = self.client.get(f"/games/{self.quiz.pk}/results/").content.decode()
        self.assertEqual(html.count(f"<code>{self.code}</code>"), 2)   # both rounds under the played code
        self.assertIn("round 1", html)
        self.assertIn("round 2", html)
        self.assertIn('name="how" value="restart"', html)

    def test_only_the_owner_can_play_again(self):
        other = get_user_model().objects.create_user("other", password="pw-pw-pw-123")
        self.client.force_login(other)
        self.assertEqual(self.play_again().status_code, 404)
        self.assertEqual(LiveSession.objects.get(code=self.code).pk, self.session.pk)

    def test_wenti_polls_too(self):
        q = Questionnaire.objects.create(owner=self.owner, title="Poll")
        qu = Question.objects.create(questionnaire=q, text="Q", type="mcq", order=0)
        Choice.objects.create(question=qu, text="A", order=0)
        poll = LiveSession.objects.create(owner=self.owner, kind="poll", questionnaire=q, state="ended")
        code = poll.code
        self.play_again(poll)
        self.assertEqual(LiveSession.objects.get(code=code).questionnaire, q)
        html = self.client.get(f"/polls/{q.pk}/results/").content.decode()
        self.assertIn(f"Run again on {code}", html)
