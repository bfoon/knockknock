import json
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from polls.models import Questionnaire
from presentations.models import LiveSession

from .models import PollChartStyle, style_for


@override_settings(STATICFILES_STORAGE="django.contrib.staticfiles.storage.StaticFilesStorage")
class PollChartStyleTests(TestCase):
    def setUp(self):
        U = get_user_model()
        self.owner = U.objects.create_user("awa", password="pw-pw-pw-123")
        self.other = U.objects.create_user("lamin", password="pw-pw-pw-123")
        self.q = Questionnaire.objects.create(owner=self.owner, title="RBM training", template_id="voxel_world")
        self.url = f"/livestyle/poll/{self.q.pk}/charts/"

    def post(self, body):
        return self.client.post(self.url, json.dumps(body), content_type="application/json")

    def test_default_is_match_theme(self):
        self.assertEqual(style_for(self.q.pk), {"style": "theme", "panel": "glass"})

    def test_save_validates_and_broadcasts(self):
        self.client.force_login(self.owner)
        with mock.patch("polls.views._broadcast_to_live_sessions") as push:
            r = self.post({"style": "panel", "panel": "light"})
        self.assertEqual(r.json(), {"ok": True, "style": "panel", "panel": "light"})
        push.assert_called_once()
        self.assertEqual(push.call_args[0][1], {"type": "chart_style", "style": "panel", "panel": "light"})
        r = self.post({"style": "rainbow", "panel": "neon"})                     # junk is ignored
        self.assertEqual((r.json()["style"], r.json()["panel"]), ("panel", "light"))
        self.assertEqual(PollChartStyle.objects.count(), 1)

    def test_only_editors_can_change_it(self):
        self.client.force_login(self.other)
        self.assertEqual(self.post({"style": "classic"}).status_code, 403)
        self.client.logout()
        self.assertEqual(self.post({"style": "classic"}).status_code, 302)
        self.assertEqual(style_for(self.q.pk)["style"], "theme")

    def test_editor_shows_the_control(self):
        self.client.force_login(self.owner)
        PollChartStyle.objects.create(questionnaire_id=self.q.pk, style="panel", panel="dark")
        r = self.client.get(f"/polls/{self.q.pk}/edit/")
        self.assertContains(r, 'data-chart-style="panel"')
        self.assertContains(r, 'data-chart-panel="dark"')
        self.assertContains(r, "kk_chart_style_editor.js")
        self.assertContains(r, "Match theme")

    def test_live_screen_gets_the_style(self):
        self.client.force_login(self.owner)
        PollChartStyle.objects.create(questionnaire_id=self.q.pk, style="classic")
        s = LiveSession.objects.create(owner=self.owner, kind="poll", questionnaire=self.q)
        r = self.client.get(f"/live/present/{s.code}/")
        self.assertContains(r, 'data-chart-style="classic"')
        self.assertContains(r, "kk_chart_style.js")
