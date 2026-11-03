"""
Short join links, the rejoin waiting room, and sharing games / Wentis
(view only, or edit and present on the owner's behalf).
"""
from asgiref.sync import sync_to_async
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from django.contrib.auth import get_user_model
from django.core import mail
from django.test import TestCase, TransactionTestCase, override_settings

from collaborations.models import Collaborator, CollaborationInvite
from games.models import Quiz
from polls.models import Choice, Question, Questionnaire, QuestionnaireCollaborator
from presentations.models import LiveSession
from presentations.routing import websocket_urlpatterns
from presentations.tests import IN_MEMORY, LOCMEM, PLAIN_STATIC, drain, last_state, make_quiz

EMAIL = "django.core.mail.backends.locmem.EmailBackend"


@override_settings(CHANNEL_LAYERS=IN_MEMORY, CACHES=LOCMEM, STORAGES=PLAIN_STATIC)
class ShortLinkAndRejoinTests(TestCase):
    def setUp(self):
        self.owner = get_user_model().objects.create_user("host", password="pw-pw-pw-123")
        self.session = LiveSession.objects.create(owner=self.owner, kind="game", quiz=make_quiz(self.owner))
        self.code = self.session.code

    def test_six_digits_at_the_root_join(self):
        for url in (f"/{self.code}", f"/{self.code}/"):
            self.assertContains(self.client.get(url), "nick", status_code=200)

    def test_join_page_takes_a_pasted_link_or_number(self):
        r = self.client.get("/join/", {"code": f"https://example.com/live/join/{self.code}/"})
        self.assertRedirects(r, f"/{self.code}", fetch_redirect_response=False)
        r = self.client.get("/live/join/", {"code": self.code})
        self.assertRedirects(r, f"/{self.code}", fetch_redirect_response=False)

    def test_presenter_shows_the_short_link(self):
        self.client.force_login(self.owner)
        html = self.client.get(f"/live/present/{self.code}/").content.decode()
        self.assertIn(f"testserver/<strong>{self.code}</strong>", html)

    def test_ended_session_waits_and_status_reports_reactivation(self):
        self.session.state = "ended"
        self.session.save()
        r = self.client.get(f"/{self.code}/")
        self.assertContains(r, "Watching for the host")
        self.assertEqual(self.client.get(f"/live/status/{self.code}/").json()["state"], "ended")
        self.session.state = "lobby"
        self.session.save()
        self.assertEqual(self.client.get(f"/live/status/{self.code}/").json()["state"], "lobby")
        self.assertNotContains(self.client.get(f"/{self.code}/"), "Watching for the host")


@override_settings(CHANNEL_LAYERS=IN_MEMORY, CACHES=LOCMEM, STORAGES=PLAIN_STATIC, EMAIL_BACKEND=EMAIL)
class ShareGameTests(TestCase):
    def setUp(self):
        U = get_user_model()
        self.owner = U.objects.create_user("bakary", email="bakary@x.gm", password="pw-pw-pw-123")
        self.fatou = U.objects.create_user("fatou", email="Fatou@x.gm", password="pw-pw-pw-123")
        self.stranger = U.objects.create_user("stranger", email="s@x.gm", password="pw-pw-pw-123")
        self.quiz = make_quiz(self.owner)
        self.share_url = f"/collab/invite/game/{self.quiz.pk}/"

    def share(self, email, permission):
        self.client.force_login(self.owner)
        return self.client.post(self.share_url, {"email": email, "permission": permission})

    def as_fatou(self):
        self.client.force_login(self.fatou)

    def test_existing_account_is_added_at_once_and_told(self):
        self.share("fatou@x.gm", "view")          # email match ignores case
        self.assertEqual(Collaborator.objects.get(user=self.fatou, kind="game").permission, "view")
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("shared", mail.outbox[0].subject)
        self.assertIn(f"/games/{self.quiz.pk}/edit/", mail.outbox[0].body)
        self.assertFalse(CollaborationInvite.objects.exists())   # no accept step needed

    def test_no_account_gets_an_invite(self):
        self.share("new@x.gm", "edit")
        inv = CollaborationInvite.objects.get()
        self.assertEqual((inv.invitee_email, inv.permission), ("new@x.gm", "edit"))
        self.assertContains(self.client.get(self.share_url), "Waiting to sign up")

    def test_viewer_can_look_but_not_touch(self):
        self.share("fatou@x.gm", "view")
        self.as_fatou()
        self.assertContains(self.client.get("/games/"), "Shared with you")
        page = self.client.get(f"/games/{self.quiz.pk}/edit/")
        self.assertContains(page, "shared this game with you")
        self.assertContains(page, " inert>")
        self.assertNotContains(page, "Start game")
        self.assertEqual(self.client.get(f"/games/{self.quiz.pk}/results/").status_code, 200)
        self.assertEqual(self.client.post(f"/games/{self.quiz.pk}/edit/", {"title": "Hacked"}).status_code, 403)
        self.assertEqual(self.client.post(f"/games/{self.quiz.pk}/start/").status_code, 403)
        self.assertEqual(self.client.post(f"/games/{self.quiz.pk}/delete/").status_code, 403)
        self.assertEqual(self.client.get(self.share_url).status_code, 403)   # only the owner shares
        self.quiz.refresh_from_db()
        self.assertEqual(self.quiz.title, "Quiz")

    def test_editor_starts_and_presents_for_the_owner(self):
        self.share("fatou@x.gm", "edit")
        self.as_fatou()
        self.assertContains(self.client.get(f"/games/{self.quiz.pk}/edit/"), "Start game for bakary")
        r = self.client.post(f"/games/{self.quiz.pk}/start/")
        session = LiveSession.objects.get(quiz=self.quiz)
        self.assertEqual(session.owner, self.owner)                 # on the owner's behalf
        self.assertRedirects(r, f"/live/present/{session.code}/", fetch_redirect_response=False)
        self.assertEqual(self.client.get(f"/live/present/{session.code}/").status_code, 200)
        # The owner can take over from their own device, and replay it.
        self.client.force_login(self.owner)
        self.assertEqual(self.client.get(f"/live/present/{session.code}/").status_code, 200)

    def test_stranger_sees_nothing(self):
        self.client.force_login(self.stranger)
        self.assertEqual(self.client.get(f"/games/{self.quiz.pk}/edit/").status_code, 404)
        self.assertEqual(self.client.get(f"/games/{self.quiz.pk}/results/").status_code, 404)
        session = LiveSession.objects.create(owner=self.owner, kind="game", quiz=self.quiz)
        self.assertEqual(self.client.get(f"/live/present/{session.code}/").status_code, 404)

    def test_owner_changes_and_removes_access(self):
        self.share("fatou@x.gm", "view")
        self.client.post(self.share_url, {"action": "change", "user_id": self.fatou.pk, "permission": "edit"})
        self.assertTrue(self.quiz.can_edit(self.fatou))
        self.client.post(self.share_url, {"action": "remove", "user_id": self.fatou.pk})
        self.assertIsNone(self.quiz.access_for(self.fatou))
        self.as_fatou()
        self.assertEqual(self.client.get(f"/games/{self.quiz.pk}/edit/").status_code, 404)

    def test_accepting_an_emailed_invite_now_gives_working_access(self):
        inv = CollaborationInvite.objects.create(inviter=self.owner, invitee_email="fatou@x.gm",
                                                 kind="game", target_id=self.quiz.pk, permission="edit")
        self.as_fatou()
        self.client.get(f"/collab/accept/{inv.token}/")
        self.assertTrue(self.quiz.can_edit(self.fatou))
        self.assertEqual(self.client.get(f"/games/{self.quiz.pk}/edit/").status_code, 200)


@override_settings(CHANNEL_LAYERS=IN_MEMORY, CACHES=LOCMEM)
class EditorPresentsLiveTests(TransactionTestCase):
    def setUp(self):
        U = get_user_model()
        self.owner = U.objects.create_user("bakary", password="pw-pw-pw-123")
        self.editor = U.objects.create_user("fatou", password="pw-pw-pw-123")
        self.viewer = U.objects.create_user("lamin", password="pw-pw-pw-123")
        self.quiz = make_quiz(self.owner)
        Collaborator.objects.create(user=self.editor, kind="game", target_id=self.quiz.pk, permission="edit")
        Collaborator.objects.create(user=self.viewer, kind="game", target_id=self.quiz.pk, permission="view")
        self.session = LiveSession.objects.create(owner=self.owner, kind="game", quiz=self.quiz)

    async def try_to_advance(self, user):
        c = WebsocketCommunicator(URLRouter(websocket_urlpatterns), f"/ws/session/{self.session.code}/")
        c.scope["user"] = user
        await c.connect()
        await c.send_json_to({"type": "hello", "role": "presenter", "uid": "x"})
        await drain(c, 0.3)
        await c.send_json_to({"type": "advance"})
        await drain(c, 0.4)
        await c.disconnect()
        s = await sync_to_async(LiveSession.objects.get)(pk=self.session.pk)
        return s.state

    async def test_editor_may_present_viewer_may_not(self):
        self.assertEqual(await self.try_to_advance(self.viewer), "lobby")
        self.assertEqual(await self.try_to_advance(self.editor), "running")


@override_settings(CHANNEL_LAYERS=IN_MEMORY, CACHES=LOCMEM, STORAGES=PLAIN_STATIC, EMAIL_BACKEND=EMAIL)
class ShareWentiTests(TestCase):
    def setUp(self):
        U = get_user_model()
        self.owner = U.objects.create_user("bakary", email="bakary@x.gm", password="pw-pw-pw-123")
        self.awa = U.objects.create_user("awa", email="awa@x.gm", password="pw-pw-pw-123")
        self.q = Questionnaire.objects.create(owner=self.owner, title="Wenti")
        qu = Question.objects.create(questionnaire=self.q, text="Q", type="mcq", order=0)
        Choice.objects.create(question=qu, text="A", order=0)
        self.client.force_login(self.owner)
        self.client.post(f"/collab/invite/menti/{self.q.pk}/", {"email": "awa@x.gm", "permission": "view"})

    def test_viewer_opens_read_only_and_sees_results(self):
        self.assertEqual(QuestionnaireCollaborator.objects.get(user=self.awa).role, "view")
        self.client.force_login(self.awa)
        self.assertContains(self.client.get("/polls/"), "Shared with you")
        page = self.client.get(f"/polls/{self.q.pk}/edit/")
        self.assertContains(page, "view only")
        self.assertNotContains(page, "Present live")
        self.assertEqual(self.client.get(f"/polls/{self.q.pk}/results/").status_code, 200)
        self.assertEqual(self.client.post(f"/polls/{self.q.pk}/start/").status_code, 403)

    def test_editor_presents_for_the_owner(self):
        self.client.post(f"/collab/invite/menti/{self.q.pk}/",
                         {"action": "change", "user_id": self.awa.pk, "permission": "edit"})
        self.client.force_login(self.awa)
        self.assertContains(self.client.get(f"/polls/{self.q.pk}/edit/"), "Present live for bakary")
        self.client.post(f"/polls/{self.q.pk}/start/")
        session = LiveSession.objects.get(questionnaire=self.q)
        self.assertEqual(session.owner, self.owner)
        self.assertEqual(self.client.get(f"/live/present/{session.code}/").status_code, 200)
