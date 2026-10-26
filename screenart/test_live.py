import json

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from hanns import screen as svc
from hanns.models import BigScreen
from polls.models import Choice, Question, Questionnaire
from presentations.models import LiveSession

from .models import ScreenLiveShare


@override_settings(CHANNEL_LAYERS={"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}},
                   STATICFILES_STORAGE="django.contrib.staticfiles.storage.StaticFilesStorage")
class LiveOnBigScreenTests(TestCase):
    def setUp(self):
        U = get_user_model()
        self.host = U.objects.create_user("host", password="pw-pw-pw-123")
        self.presenter = U.objects.create_user("awa", password="pw-pw-pw-123")
        self.screen = BigScreen.objects.create(owner=self.host, name="Main Screen")
        q = Questionnaire.objects.create(owner=self.presenter, title="RBM training")
        for i in range(3):
            qu = Question.objects.create(questionnaire=q, text=f"Q{i}", type="mcq", order=i)
            Choice.objects.create(question=qu, text="A", order=0)
        self.session = LiveSession.objects.create(owner=self.presenter, kind="poll", questionnaire=q)
        self.base = f"/screenart/s/{self.screen.token}/"

    def j(self, url, body=None):
        return self.client.post(url, json.dumps(body or {}), content_type="application/json")

    def share(self):
        self.client.force_login(self.presenter)
        r = self.j("/screenart/live/share/", {"session": self.session.code, "screen_code": self.screen.share_code})
        self.client.logout()
        return r

    def test_presenter_sends_their_session_to_the_screen(self):
        r = self.share()
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["screen"], "Main Screen")
        live = svc.screen_state(self.screen)["live"]
        self.assertEqual(len(live["shares"]), 1)
        s = live["shares"][0]
        self.assertEqual((s["kind"], s["title"], s["status"], s["state"], s["total"]), ("poll", "RBM training", "waiting", "lobby", 3))
        self.assertIsNone(live["on_air"])
        self.share()                                            # sending twice doesn't duplicate
        self.assertEqual(ScreenLiveShare.objects.count(), 1)

    def test_only_the_sessions_owner_can_send_it(self):
        self.client.force_login(self.host)
        r = self.j("/screenart/live/share/", {"session": self.session.code, "screen_code": self.screen.share_code})
        self.assertEqual(r.status_code, 400)
        self.client.logout()
        self.assertEqual(self.j("/screenart/live/share/", {"session": self.session.code}).status_code, 302)
        self.assertFalse(ScreenLiveShare.objects.exists())

    def test_wrong_screen_code(self):
        self.client.force_login(self.presenter)
        r = self.j("/screenart/live/share/", {"session": self.session.code, "screen_code": "000000"})
        self.assertEqual(r.status_code, 400)
        self.assertIn("No big screen", r.json()["error"])

    def test_host_puts_it_on_air_and_runs_it(self):
        share_id = self.share().json()["share"]
        live = self.j(self.base + f"live/{share_id}/air/", {"on": True}).json()["state"]["live"]
        self.assertEqual(live["on_air"], share_id)
        r = self.j(self.base + f"live/{share_id}/control/", {"action": "next"})        # lobby → question 1
        self.assertEqual(r.status_code, 200, r.content)
        self.session.refresh_from_db()
        self.assertEqual((self.session.state, self.session.current_question_index), ("running", 0))
        self.assertEqual(r.json()["state"]["live"]["shares"][0]["index"], 0)
        self.j(self.base + f"live/{share_id}/control/", {"action": "next"})
        self.j(self.base + f"live/{share_id}/control/", {"action": "next"})
        self.session.refresh_from_db()
        self.assertEqual(self.session.current_question_index, 2)
        self.j(self.base + f"live/{share_id}/control/", {"action": "back"})
        self.session.refresh_from_db()
        self.assertEqual(self.session.current_question_index, 1)
        self.j(self.base + f"live/{share_id}/control/", {"action": "end"})
        self.session.refresh_from_db()
        self.assertEqual(self.session.state, "ended")
        self.assertEqual(self.j(self.base + f"live/{share_id}/control/", {"action": "explode"}).status_code, 400)

    def test_one_live_session_on_air_at_a_time(self):
        a = self.share().json()["share"]
        q2 = Questionnaire.objects.create(owner=self.presenter, title="Second")
        s2 = LiveSession.objects.create(owner=self.presenter, kind="poll", questionnaire=q2)
        self.client.force_login(self.presenter)
        b = self.j("/screenart/live/share/", {"session": s2.code, "screen_code": self.screen.share_code}).json()["share"]
        self.client.logout()
        self.j(self.base + f"live/{a}/air/", {"on": True})
        live = self.j(self.base + f"live/{b}/air/", {"on": True}).json()["state"]["live"]
        self.assertEqual(live["on_air"], b)
        self.assertEqual(sorted(s["status"] for s in live["shares"]), ["onair", "waiting"])

    def test_projector_view_is_display_only(self):
        share_id = self.share().json()["share"]
        r = self.client.get(self.base + f"live/{share_id}/view/")
        self.assertEqual(r.status_code, 200)
        self.assertContains(r, "__KK_SCREEN_MODE__")
        self.assertContains(r, "kk-screen-mode")
        self.assertNotContains(r, "kk_bigscreen_share.js")
        self.assertEqual(r.headers.get("X-Frame-Options"), "SAMEORIGIN")

    def test_another_screen_cannot_touch_it(self):
        share_id = self.share().json()["share"]
        other = BigScreen.objects.create(owner=self.host, name="Room B")
        ob = f"/screenart/s/{other.token}/"
        self.assertEqual(self.client.get(ob + f"live/{share_id}/view/").status_code, 404)
        self.assertEqual(self.j(ob + f"live/{share_id}/control/", {"action": "next"}).status_code, 400)
        self.session.refresh_from_db()
        self.assertEqual(self.session.state, "lobby")

    def test_remove_unshare_and_stop(self):
        share_id = self.share().json()["share"]
        self.j(self.base + f"live/{share_id}/remove/")
        self.assertFalse(ScreenLiveShare.objects.exists())
        self.share()
        self.client.force_login(self.presenter)
        self.j("/screenart/live/unshare/", {"session": self.session.code})
        self.assertFalse(ScreenLiveShare.objects.exists())
        share_id = self.share().json()["share"]
        self.client.post(f"/hanns/screen/s/{self.screen.token}/stop/")
        self.assertFalse(ScreenLiveShare.objects.exists())
        self.assertEqual(self.j(self.base + f"live/{share_id}/air/", {"on": True}).status_code, 410)

    def test_presenter_page_has_the_big_screen_button(self):
        self.client.force_login(self.presenter)
        r = self.client.get(f"/live/present/{self.session.code}/")
        self.assertContains(r, 'id="kk-bigscreen-btn"')
        self.assertContains(r, "kk_bigscreen_share.js")


@override_settings(CHANNEL_LAYERS={"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}})
class LiveGameOnBigScreenTests(TestCase):
    def test_a_game_shares_and_runs_with_reveal(self):
        from games.models import GameChoice, GameQuestion, Quiz
        U = get_user_model()
        host = U.objects.create_user("host", password="pw-pw-pw-123")
        pres = U.objects.create_user("lamin", password="pw-pw-pw-123")
        screen = BigScreen.objects.create(owner=host, name="Hall")
        quiz = Quiz.objects.create(owner=pres, title="Gambia trivia")
        for i in range(2):
            gq = GameQuestion.objects.create(quiz=quiz, text=f"G{i}", order=i)
            GameChoice.objects.create(question=gq, text="Yes", is_correct=True)
            GameChoice.objects.create(question=gq, text="No")
        session = LiveSession.objects.create(owner=pres, kind="game", quiz=quiz)
        self.client.force_login(pres)
        r = self.client.post("/screenart/live/share/", json.dumps({"session": session.code, "screen_code": screen.share_code}),
                             content_type="application/json")
        self.client.logout()
        share_id = r.json()["share"]
        base = f"/screenart/s/{screen.token}/live/{share_id}/"
        row = svc.screen_state(screen)["live"]["shares"][0]
        self.assertEqual((row["kind"], row["title"], row["total"]), ("game", "Gambia trivia", 2))
        self.client.post(base + "air/", json.dumps({"on": True}), content_type="application/json")
        for action in ("next", "reveal", "extend", "next"):
            resp = self.client.post(base + "control/", json.dumps({"action": action}), content_type="application/json")
            self.assertEqual(resp.status_code, 200, (action, resp.content))
        session.refresh_from_db()
        self.assertEqual((session.state, session.current_question_index), ("running", 1))
