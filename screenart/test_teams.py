import json
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase

from hanns import screen as svc
from hanns.models import BigScreen
from screenart import teams as tm

INVITE = """Microsoft Teams Need help?
Join the meeting now
Meeting ID: 381 234 567 890 1
Passcode: aB3dE5
________________________________
Dial in by phone  +1 323-555-0100,,123456789#"""


class ParseTests(TestCase):
    def test_pasted_invitation(self):
        r = tm.parse(INVITE)
        self.assertEqual(r["url"], "https://teams.microsoft.com/meet/3812345678901?p=aB3dE5")
        self.assertEqual((r["id"], r["label"], r["kind"]), ("3812345678901", "Teams meeting 381 234 567 890 1", "work"))

    def test_links(self):
        long = "https://teams.microsoft.com/l/meetup-join/19%3ameeting_ZmQ5%40thread.v2/0?context=%7b%22Tid%22%3a%22abc%22%7d"
        self.assertEqual(tm.parse(f"Join here: {long} .")["url"], long)
        self.assertEqual(tm.parse("https://teams.microsoft.com/meet/3812345678901?p=aB3dE5")["id"], "3812345678901")
        r = tm.parse("https://teams.live.com/meet/9876543210123?p=Zz9")
        self.assertEqual((r["kind"], r["url"]), ("personal", "https://teams.live.com/meet/9876543210123?p=Zz9"))
        self.assertTrue(tm.parse("https://teams.cloud.microsoft/meet/3812345678901?p=x1")["url"].startswith("https://teams.cloud.microsoft/"))

    def test_outlook_safe_links_are_unwrapped(self):
        wrapped = ("https://nam12.safelinks.protection.outlook.com/?url=https%3A%2F%2Fteams.microsoft.com%2Fmeet%2F"
                   "3812345678901%3Fp%3DaB3dE5&data=05%7C02&reserved=0")
        self.assertEqual(tm.parse(wrapped)["url"], "https://teams.microsoft.com/meet/3812345678901?p=aB3dE5")

    def test_id_and_passcode_fields(self):
        r = tm.parse("", "381 234 567 890 1", "aB3dE5")
        self.assertEqual(r["url"], "https://teams.microsoft.com/meet/3812345678901?p=aB3dE5")
        r = tm.parse("", "3812345678901", "aB3dE5", kind="personal")
        self.assertEqual(r["url"], "https://teams.live.com/meet/3812345678901?p=aB3dE5")
        self.assertEqual(tm.parse("381 234 567 890 1", passcode="Q1")["id"], "3812345678901")   # ID in the box

    def test_refuses_what_isnt_teams(self):
        for bad in ("https://evil.example/meet/3812345678901?p=x", "https://teams.microsoft.com.evil.example/meet/1",
                    "javascript:alert(1)", "https://safelinks.protection.outlook.com.evil/?url=https%3A%2F%2Fevil.example"):
            with self.assertRaises(tm.TeamsError, msg=bad):
                tm.parse(bad)
        with self.assertRaises(tm.TeamsError):
            tm.parse("", "12345", "x")                     # too short
        with self.assertRaises(tm.TeamsError):
            tm.parse("", "3812345678901", "")              # no passcode
        with self.assertRaises(tm.TeamsError):
            tm.parse("", "3812345678901", "a b<script>")   # not a passcode
        with self.assertRaises(tm.TeamsError):
            tm.parse("")


class EndpointTests(TestCase):
    def setUp(self):
        u = get_user_model().objects.create_user("t-host", password="pw-pw-pw-123")
        self.screen = BigScreen.objects.create(owner=u, name="Hall 2")
        self.url = f"/screenart/s/{self.screen.token}/teams/"

    def post(self, **b):
        return self.client.post(self.url, json.dumps(b), content_type="application/json")

    def test_open_close_and_state(self):
        self.assertEqual(svc.screen_state(self.screen)["teams"]["on"], False)
        r = self.post(action="check", invite=INVITE)                      # parse only
        self.assertEqual(r.json()["teams"]["id"], "3812345678901")
        self.assertFalse(svc.screen_state(self.screen)["teams"]["on"])
        sent = []
        with mock.patch.object(svc, "_send", side_effect=lambda g, m: sent.append(m["payload"])):
            r = self.post(action="open", invite=INVITE, label="  Board   call ")
        st = svc.screen_state(self.screen)["teams"]
        self.assertEqual((st["on"], st["label"], st["url"]), (True, "Board call", "https://teams.microsoft.com/meet/3812345678901?p=aB3dE5"))
        self.assertTrue(any(p.get("type") == "screen_state" for p in sent))
        self.assertEqual((st["shown"], st["mode"]), (True, ""))
        self.post(action="report", mode="inside")                          # the projector captured it
        self.post(action="hide")                                           # back to Knock Knock, meeting runs on
        st = svc.screen_state(self.screen)["teams"]
        self.assertEqual((st["on"], st["shown"], st["mode"]), (True, False, "inside"))
        self.post(action="show")
        self.assertTrue(svc.screen_state(self.screen)["teams"]["shown"])
        self.assertEqual(self.post(action="report", mode="tv").status_code, 400)
        self.post(action="close")
        st = svc.screen_state(self.screen)["teams"]
        self.assertEqual((st["on"], st["shown"], st["mode"], st["url"], st["label"]), (False, False, "", "", "Board call"))
        self.assertEqual(self.post(action="hide").status_code, 400)        # nothing running
        self.assertEqual(self.post(action="open", invite="https://evil.example/x").status_code, 400)
        self.assertEqual(self.post(action="launch").status_code, 400)
        self.screen.is_active = False
        self.screen.save()
        self.assertEqual(self.post(action="close").status_code, 410)
