"""Door screen: a read-only link for the TVs outside the room (screenart/door.py)."""
import datetime as dt
import json

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone

from hanns import screen as svc
from hanns.models import BigScreen

from . import door as doorsvc
from .models import ScreenStyle


PLAIN_STATIC = {"default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
                "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"}}


@override_settings(CHANNEL_LAYERS={"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}, STORAGES=PLAIN_STATIC)
class DoorTests(TestCase):
    def setUp(self):
        from attendance.models import AgendaDay, AgendaItem, AttendanceEvent, Registration
        self.host = get_user_model().objects.create_user("host", password="pw-pw-pw-123")
        self.screen = BigScreen.objects.create(owner=self.host, name="Main hall")
        self.base = f"/screenart/s/{self.screen.token}/"
        now = timezone.now()
        self.ev = AttendanceEvent.objects.create(owner=self.host, title="Gambia Youth Summit", starts_at=now, ends_at=now + dt.timedelta(hours=8),
                                                 timezone_name="Africa/Banjul", location="Banjul")
        Registration.objects.create(event=self.ev, full_name="Awa Jallow", email="a@x.gm", status="accepted", checked_in_at=now)
        day = AgendaDay.objects.create(event=self.ev, date=now.date(), label="Day one")
        AgendaItem.objects.create(event=self.ev, day=day, order=0, start_time=dt.time(9, 0), end_time=dt.time(10, 0), title="Opening", speaker="Hon. Minister")

    def host_post(self, **body):
        return self.client.post(self.base + "door/", json.dumps(body), content_type="application/json")

    def link_on(self):
        d = self.host_post(op="set", on=True).json()["door"]
        return d["token"], d["url"]

    # ── the link ──
    def test_off_by_default_and_token_made_on_first_switch_on(self):
        d = self.host_post(op="get").json()["door"]
        self.assertEqual((d["on"], d["token"], d["url"]), (False, "", ""))
        token, url = self.link_on()
        self.assertTrue(doorsvc.TOKEN_RE.match(token))
        self.assertTrue(url.endswith(f"/screenart/door/{token}/"))
        self.assertNotEqual(token, self.screen.token)                         # never the projector's credential

    def test_switch_off_and_replace(self):
        token, _ = self.link_on()
        self.assertEqual(self.client.get(f"/screenart/door/{token}/").status_code, 200)
        self.host_post(op="set", on=False)
        self.assertEqual(self.client.get(f"/screenart/door/{token}/").status_code, 404)
        self.assertEqual(self.client.get(f"/screenart/door/{token}/state/").status_code, 404)
        new = self.host_post(op="rotate").json()["door"]["token"]
        self.assertNotEqual(new, token)
        self.assertEqual(self.client.get(f"/screenart/door/{token}/").status_code, 404)
        self.assertEqual(self.client.get(f"/screenart/door/{new}/").status_code, 200)

    def test_bad_tokens(self):
        for t in ("x", "a" * 200, "../../etc", self.screen.token):
            self.assertEqual(self.client.get(f"/screenart/door/{t}/state/").status_code, 404, t)

    # ── what the door shows (and doesn't) ──
    def test_state_is_read_only_and_minimal(self):
        token, _ = self.link_on()
        from . import program, services
        program.set_event(self.screen, {"id": self.ev.pk, "view": "checkin", "welcome": True})
        services.update_settings(self.screen.id, {"caption": "Lunch break", "countdown": "14:30"})
        st = self.client.get(f"/screenart/door/{token}/state/").json()
        self.assertEqual((st["active"], st["caption"], st["countdown"]), (True, "Lunch break", "14:30"))
        self.assertEqual(st["event"]["title"], "Gambia Youth Summit")
        self.assertEqual(st["event"]["agenda"][0]["items"][0]["title"], "Opening")
        self.assertEqual(st["event"]["tz"], "Africa/Banjul")
        raw = json.dumps(st)
        for secret in (self.screen.share_code, self.screen.token, "Awa", "checkin_url", "register_url", "arrivals", token):
            self.assertNotIn(secret, raw, secret)

    def test_toggles(self):
        token, _ = self.link_on()
        from . import program, services
        program.set_event(self.screen, {"id": self.ev.pk})
        services.update_settings(self.screen.id, {"caption": "Lunch break", "countdown": "14:30"})
        self.host_post(op="set", agenda=False, caption=False, clock=False, title="Room 3 · Summit")
        st = self.client.get(f"/screenart/door/{token}/state/").json()
        self.assertEqual((st["caption"], st["countdown"], st["event"]["agenda"], st["name"]), ("", "", [], "Room 3 · Summit"))
        self.assertEqual(st["show"], {"agenda": False, "clock": False, "caption": False})

    def test_stopped_screen_shows_room_free(self):
        token, _ = self.link_on()
        self.screen.is_active = False; self.screen.save()
        st = self.client.get(f"/screenart/door/{token}/state/").json()
        self.assertEqual((st["active"], st["event"], st["background"]), (False, None, None))
        self.assertIn("This room is free", self.client.get(f"/screenart/door/{token}/").content.decode())
        self.assertEqual(self.host_post(op="set", title="x").status_code, 410)      # no changes on a stopped screen

    def test_big_screen_snapshot_never_carries_the_door_token(self):
        token, _ = self.link_on()
        self.assertNotIn(token, json.dumps(svc.screen_state(self.screen)))
        # and other screen settings keep working next to it
        from . import services
        services.update_settings(self.screen.id, {"caption": "Hi"})
        self.assertEqual(doorsvc.door_for(self.screen.id)["token"], token)

    # ── the welcome host ──
    def test_greeter_settings_are_validated(self):
        self.link_on()
        d = self.host_post(op="set", greeter={"figure": "man", "outfit": "casual", "style": "robot", "side": "right", "skin": 9,
                                              "every": 7, "sign": False, "lines": "Welcome!\n\nDalal ak jàmm\n" + "x" * 80,
                                              "way": "", "evil": "<script>"}).json()["door"]["greeter"]
        self.assertEqual((d["figure"], d["outfit"], d["style"], d["side"], d["skin"], d["every"], d["sign"]),
                         ("man", "casual", "robot", "right", 3, 6, False))                 # 7 s is not an option: unchanged
        self.assertEqual(d["lines"], ["Welcome!", "Dalal ak jàmm", "x" * 40])
        self.assertEqual(d["way"], doorsvc.DEFAULT_GREETER["way"])
        self.assertNotIn("evil", d)
        d = self.host_post(op="set", greeter={"figure": "alien", "lines": ["a"] * 10}).json()["door"]["greeter"]
        self.assertEqual((d["figure"], len(d["lines"])), ("man", doorsvc.MAX_LINES))

    def test_page_renders_greeter_and_state(self):
        token, _ = self.link_on()
        html = self.client.get(f"/screenart/door/{token}/?preview=1").content.decode()
        for bit in ("door_greeter.js", 'id="door-state"', 'class="preview"', f"/screenart/door/{token}/state/"):
            self.assertIn(bit, html)
        self.assertNotIn(self.screen.share_code, html)

    def test_stored_in_screen_style_no_migration(self):
        token, _ = self.link_on()
        self.assertEqual(ScreenStyle.objects.get(screen_id=self.screen.id).settings["door"]["token"], token)
