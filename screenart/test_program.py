import datetime as dt
import json
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone

from hanns import screen as svc
from hanns.models import BigScreen

from . import program


class YouTubeLinkTests(TestCase):
    def test_common_link_shapes(self):
        cases = {
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ": ("dQw4w9WgXcQ", 0),
            "https://youtu.be/dQw4w9WgXcQ?t=90": ("dQw4w9WgXcQ", 90),
            "youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s": ("dQw4w9WgXcQ", 90),
            "https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1": ("dQw4w9WgXcQ", 0),
            "https://www.youtube.com/shorts/aqz-KE-bpKQ": ("aqz-KE-bpKQ", 0),
            "https://www.youtube.com/embed/aqz-KE-bpKQ?start=12": ("aqz-KE-bpKQ", 12),
            "https://www.youtube.com/live/aqz-KE-bpKQ": ("aqz-KE-bpKQ", 0),
            "https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ": ("aqz-KE-bpKQ", 0),
            "dQw4w9WgXcQ": ("dQw4w9WgXcQ", 0),
        }
        for url, want in cases.items():
            self.assertEqual(program.parse_youtube(url), want, url)

    def test_not_youtube(self):
        for bad in ("", "https://vimeo.com/123", "https://evil.example/watch?v=dQw4w9WgXcQ",
                    "https://youtube.com/watch?v=short", "javascript:alert(1)"):
            with self.assertRaises(program.ProgramError, msg=bad):
                program.parse_youtube(bad)


@override_settings(CHANNEL_LAYERS={"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}})
class MediaTests(TestCase):
    def setUp(self):
        self.host = get_user_model().objects.create_user("host", password="pw-pw-pw-123")
        self.screen = BigScreen.objects.create(owner=self.host, name="Main hall")
        self.url = f"/screenart/s/{self.screen.token}/media/"
        self.titles = mock.patch.object(program, "video_title", side_effect=lambda vid: f"Video {vid}")
        self.titles.start()

    def tearDown(self):
        self.titles.stop()

    def act(self, **body):
        r = self.client.post(self.url, json.dumps(body), content_type="application/json")
        return r, (r.json().get("state") or {}).get("media")

    def test_play_audio_then_queue_and_skip(self):
        r, m = self.act(action="load", url="https://youtu.be/dQw4w9WgXcQ", mode="audio")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual((m["current"]["id"], m["current"]["title"], m["mode"], m["playing"]), ("dQw4w9WgXcQ", "Video dQw4w9WgXcQ", "audio", True))
        self.assertIn("server_now", m)
        _, m = self.act(action="queue", url="https://www.youtube.com/watch?v=aqz-KE-bpKQ")
        self.assertEqual([i["id"] for i in m["queue"]], ["aqz-KE-bpKQ"])
        _, m = self.act(action="pause")
        self.assertFalse(m["playing"])
        _, m = self.act(action="play")
        self.assertTrue(m["playing"])
        _, m = self.act(action="next")
        self.assertEqual((m["current"]["id"], m["queue"]), ("aqz-KE-bpKQ", []))
        _, m = self.act(action="stop")
        self.assertIsNone(m["current"])

    def test_ended_moves_on_only_for_the_current_track(self):
        _, m = self.act(action="load", url="dQw4w9WgXcQ", mode="video")
        first = m["current"]["key"]
        self.act(action="queue", url="aqz-KE-bpKQ")
        _, m = self.act(action="ended", key="some-old-key")                  # a stale projector report
        self.assertEqual(m["current"]["key"], first)
        _, m = self.act(action="ended", key=first)
        self.assertEqual(m["current"]["id"], "aqz-KE-bpKQ")
        _, m = self.act(action="ended", key=m["current"]["key"])            # queue empty, no loop → stops
        self.assertIsNone(m["current"])

    def test_loop_replays(self):
        _, m = self.act(action="load", url="dQw4w9WgXcQ", mode="audio")
        self.act(action="loop", loop=True)
        _, m2 = self.act(action="ended", key=m["current"]["key"])
        self.assertEqual(m2["current"]["id"], "dQw4w9WgXcQ")
        self.assertTrue(m2["playing"])

    def test_settings_and_errors(self):
        r, _ = self.act(action="load", url="https://vimeo.com/1")
        self.assertEqual(r.status_code, 400)
        _, m = self.act(action="volume", volume=250)
        self.assertEqual(m["volume"], 100)
        self.assertEqual(self.act(action="dance")[0].status_code, 400)
        self.assertEqual(svc.screen_state(self.screen)["media"]["volume"], 100)

    def test_stopped_screen(self):
        self.screen.is_active = False
        self.screen.save()
        self.assertEqual(self.act(action="play")[0].status_code, 410)


@override_settings(CHANNEL_LAYERS={"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}})
class EventViewTests(TestCase):
    def setUp(self):
        from attendance.models import AgendaDay, AgendaItem, AttendanceEvent, Registration
        U = get_user_model()
        self.host = U.objects.create_user("host", password="pw-pw-pw-123")
        other = U.objects.create_user("other", password="pw-pw-pw-123")
        self.screen = BigScreen.objects.create(owner=self.host, name="Main hall")
        now = timezone.now()
        self.ev = AttendanceEvent.objects.create(owner=self.host, title="Gambia Youth Summit", starts_at=now, ends_at=now + dt.timedelta(hours=8),
                                                 timezone_name="Africa/Banjul", capacity=50, location="Banjul")
        self.foreign = AttendanceEvent.objects.create(owner=other, title="Someone else's", starts_at=now, ends_at=now)
        for i, (name, status, checked) in enumerate([("Awa Jallow", "accepted", True), ("Lamin Ceesay", "accepted", True),
                                                      ("Fatou Sowe", "pending", False), ("No Show", "cancelled", False)]):
            Registration.objects.create(event=self.ev, full_name=name, email=f"p{i}@x.gm", status=status,
                                        checked_in_at=now - dt.timedelta(minutes=10 - i) if checked else None)
        day = AgendaDay.objects.create(event=self.ev, date=now.date(), label="Day one")
        AgendaItem.objects.create(event=self.ev, day=day, order=0, start_time=dt.time(9, 0), end_time=dt.time(10, 0), title="Opening", speaker="Hon. Minister")
        AgendaItem.objects.create(event=self.ev, day=day, order=1, start_time=dt.time(10, 0), end_time=dt.time(11, 0), title="Panel: Jobs", track="Main hall")
        self.base = f"/screenart/s/{self.screen.token}/"

    def post(self, body):
        return self.client.post(self.base + "event/", json.dumps(body), content_type="application/json")

    def test_lists_only_the_owners_events(self):
        titles = [e["title"] for e in self.client.get(self.base + "events/").json()["events"]]
        self.assertEqual(titles, ["Gambia Youth Summit"])
        self.assertEqual(self.post({"id": self.foreign.pk}).status_code, 400)
        self.assertEqual(self.post({"view": "agenda"}).status_code, 400)         # no event chosen yet

    def test_registration_counts_and_links(self):
        self.post({"id": self.ev.pk})
        st = self.post({"view": "register"}).json()["state"]["event"]
        self.assertEqual((st["id"], st["view"]), (self.ev.pk, "register"))
        d = self.client.get(self.base + "event/data/").json()["event"]
        self.assertEqual((d["registered"], d["checked_in"], d["capacity"]), (3, 2, 50))     # cancelled doesn't count
        self.assertIn(f"/e/{self.ev.public_token}/", d["register_url"])
        self.assertIn(f"/e/{self.ev.public_token}/checkin/", d["checkin_url"])
        self.assertEqual(d["tz"], "Africa/Banjul")
        self.assertNotIn("arrivals", d)                                          # welcomes are opt-in

    def test_welcomes_use_first_names_only(self):
        self.post({"id": self.ev.pk, "view": "checkin", "welcome": True})
        d = self.client.get(self.base + "event/data/").json()["event"]
        self.assertEqual([a["name"] for a in d["arrivals"]], ["Lamin", "Awa"])   # newest first
        blob = json.dumps(d)
        for secret in ("Jallow", "Ceesay", "@x.gm"):
            self.assertNotIn(secret, blob)

    def test_agenda(self):
        self.post({"id": self.ev.pk, "view": "agenda"})
        d = self.client.get(self.base + "event/data/").json()["event"]
        day = d["agenda"][0]
        self.assertEqual(day["label"], "Day one")
        self.assertEqual([(i["start"], i["end"], i["title"]) for i in day["items"]], [("09:00", "10:00", "Opening"), ("10:00", "11:00", "Panel: Jobs")])
        self.assertEqual(day["items"][0]["speaker"], "Hon. Minister")

    def test_no_event_means_no_data(self):
        self.assertIsNone(self.client.get(self.base + "event/data/").json()["event"])

    def test_dashboard_and_stage_load_the_script(self):
        with self.settings(STATICFILES_STORAGE="django.contrib.staticfiles.storage.StaticFilesStorage"):
            self.assertContains(self.client.get(f"/hanns/screen/s/{self.screen.token}/"), "hanns_screen_program.js")
            self.client.force_login(self.host)
            self.assertContains(self.client.get("/hanns/screen/"), "hanns_screen_program.js")
