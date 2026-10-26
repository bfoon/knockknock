"""Security: only the session owner may control a live poll / game."""

from asgiref.sync import sync_to_async
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from django.contrib.auth import get_user_model
from django.test import TransactionTestCase, override_settings

from polls.models import Choice, Question, Questionnaire
from presentations.models import LiveSession
from presentations.routing import websocket_urlpatterns


@override_settings(CHANNEL_LAYERS={"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}})
class PresenterRoleTests(TransactionTestCase):
    def setUp(self):
        U = get_user_model()
        self.owner = U.objects.create_user("host", password="pw-pw-pw-123")
        self.stranger = U.objects.create_user("stranger", password="pw-pw-pw-123")
        q = Questionnaire.objects.create(owner=self.owner, title="Poll")
        for i in range(2):
            qu = Question.objects.create(questionnaire=q, text=f"Q{i}", type="mcq", order=i)
            Choice.objects.create(question=qu, text="A", order=0)
        self.session = LiveSession.objects.create(owner=self.owner, kind="poll", questionnaire=q)

    async def _connect(self, user=None):
        c = WebsocketCommunicator(URLRouter(websocket_urlpatterns), f"/ws/session/{self.session.code}/")
        if user is not None:
            c.scope["user"] = user
        ok, _ = await c.connect()
        self.assertTrue(ok)
        return c

    async def _index(self):
        s = await sync_to_async(LiveSession.objects.get)(pk=self.session.pk)
        return s.current_question_index

    async def _drain(self, c):
        while not await c.receive_nothing(timeout=0.2):
            await c.receive_json_from()

    async def test_stranger_claiming_presenter_cannot_advance(self):
        start = await self._index()
        for user in (None, self.stranger):
            c = await self._connect(user)
            await c.send_json_to({"type": "hello", "role": "presenter"})
            await self._drain(c)
            await c.send_json_to({"type": "advance"})
            await c.send_json_to({"type": "end"})
            await self._drain(c)
            self.assertEqual(await self._index(), start)
            await c.disconnect()
        s = await sync_to_async(LiveSession.objects.get)(pk=self.session.pk)
        self.assertNotEqual(s.state, "ended")

    async def test_owner_still_presents(self):
        start = await self._index()
        c = await self._connect(self.owner)
        await c.send_json_to({"type": "hello", "role": "presenter"})
        await self._drain(c)
        await c.send_json_to({"type": "advance"})
        await self._drain(c)
        self.assertEqual(await self._index(), start + 1)
        await c.disconnect()
