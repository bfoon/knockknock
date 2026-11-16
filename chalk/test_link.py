"""Chalk Link: the board's HTTP API."""

import json

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from django.urls import reverse

from .models import Board, BoardLink

User = get_user_model()


class LinkTests(TestCase):
    def setUp(self):
        cache.clear()
        self.owner = User.objects.create_user("teacher", password="pw")
        self.other = User.objects.create_user("nosy", password="pw")
        self.board = Board.objects.create(owner=self.owner, title="Year 8 electronics")
        self.client.force_login(self.owner)
        self.manage = reverse("chalk:link_manage", args=[self.board.id])

    def open(self):
        r = self.client.post(self.manage, data=json.dumps({"action": "open"}), content_type="application/json")
        self.assertEqual(r.status_code, 200)
        return r.json()

    def url(self, name, *args):
        return reverse("chalk:" + name, args=[self.key, *args])

    def post(self, url, data):
        return self.client.post(url, data=json.dumps(data), content_type="application/json")

    # -- the owner's side ---------------------------------------------------

    def test_a_board_has_no_link_until_one_is_opened(self):
        self.assertEqual(self.client.get(self.manage).json(), {"ok": True, "open": False})
        j = self.open()
        self.assertTrue(j["open"] and j["key"].startswith("ck_") and j["url"].endswith(f"/chalk/api/link/{j['key']}/"))
        self.assertEqual(self.open()["key"], j["key"], "opening twice keeps the same key")

    def test_only_the_owner_can_open_or_see_it(self):
        self.open()
        self.client.force_login(self.other)
        self.assertEqual(self.client.get(self.manage).status_code, 404)
        self.assertEqual(self.client.post(self.manage, {"action": "rotate"}).status_code, 404)
        self.client.logout()
        self.assertEqual(self.client.get(self.manage).status_code, 403)

    def test_rotating_cuts_off_the_old_key(self):
        self.key = self.open()["key"]
        self.client.logout()
        self.assertEqual(self.client.get(self.url("link_tags")).status_code, 200)
        self.client.force_login(self.owner)
        new = self.post(self.manage, {"action": "rotate"}).json()["key"]
        self.assertNotEqual(new, self.key)
        self.assertEqual(self.client.get(self.url("link_tags")).status_code, 404)
        self.post(self.manage, {"action": "close"})
        self.assertFalse(BoardLink.objects.exists())

    # -- the API: no login, no CSRF, the key is the secret -------------------

    def api(self):
        self.key = self.open()["key"]
        self.client.logout()
        self.client = self.client_class(enforce_csrf_checks=True)

    def test_write_and_read_tags(self):
        self.api()
        r = self.post(self.url("link_tags"), {"values": {"lamp": True, "Temperature": 21.5, "note": "hi"}, "by": "my-app"})
        self.assertEqual(r.json(), {"ok": True, "seq": 3})
        self.assertEqual(r["Access-Control-Allow-Origin"], "*")
        j = self.client.get(self.url("link_tags")).json()
        self.assertEqual(j["seq"], 3)
        self.assertEqual(j["tags"]["temperature"]["value"], 21.5)
        self.assertEqual(j["tags"]["lamp"]["by"], "my-app")
        self.assertEqual(self.client.get(self.url("link_tags") + "?flat=1").json(), {"lamp": True, "temperature": 21.5, "note": "hi"})
        # a flat object works too, and so does one tag at a time
        self.post(self.url("link_tags"), {"fan": 0})
        self.assertEqual(self.client.get(self.url("link_tag", "fan")).json()["value"], 0)
        self.client.put(self.url("link_tag", "fan"), data=json.dumps({"value": 180}), content_type="application/json")
        self.client.post(self.url("link_tag", "door"), data="open", content_type="text/plain")
        self.assertEqual(self.client.get(self.url("link_tag", "fan") + "?raw=1").content, b"180")
        self.assertEqual(self.client.get(self.url("link_tag", "door")).json()["value"], "open")
        self.assertEqual(self.client.get(self.url("link_tag", "lamp") + "?raw=1").content, b"1")

    def test_only_changes_move_the_sequence(self):
        self.api()
        self.post(self.url("link_tags"), {"values": {"t": 21.5}})
        self.post(self.url("link_tags"), {"values": {"t": 21.5}})
        self.post(self.url("link_tags"), {"values": {"t": 22}})
        j = self.client.get(self.url("link_tags")).json()
        self.assertEqual((j["seq"], j["tags"]["t"]["value"]), (2, 22))
        self.assertEqual(self.client.get(self.url("link_tags") + "?since=2").json()["tags"], {})
        self.assertEqual(list(self.client.get(self.url("link_tags") + "?since=1").json()["tags"]), ["t"])
        ev = self.client.get(self.url("link_events")).json()["events"]
        self.assertEqual([(e["name"], e["value"]) for e in ev], [("t", 21.5), ("t", 22)])
        # true is not 1: a switch that becomes a count is a change
        self.post(self.url("link_tags"), {"values": {"t": True}})
        self.assertIs(self.client.get(self.url("link_tag", "t")).json()["value"], True)

    def test_a_device_that_can_only_get(self):
        self.api()
        r = self.client.get(self.url("link_set") + "?lamp=on&level=42&temp=21.5&name=esp32%20one&by=esp32")
        self.assertTrue(r.json()["ok"])
        self.assertEqual(self.client.get(self.url("link_tags") + "?flat=1").json(), {"lamp": True, "level": 42, "temp": 21.5, "name": "esp32 one"})
        self.assertEqual(self.client.get(self.url("link_tag", "lamp")).json()["by"], "esp32")

    def test_bad_requests_say_why(self):
        self.api()
        for body, word in (({"values": {"bad name!": 1}}, "not a tag name"), ({"values": {"a": [1, 2]}}, "must be a number"),
                           ({"values": {"a": "x" * 500}}, "longer than"), ({"values": {}}, "no values")):
            r = self.post(self.url("link_tags"), body)
            self.assertEqual(r.status_code, 400)
            self.assertIn(word, r.json()["error"])
        r = self.client.post(self.url("link_tags"), data="{not json", content_type="application/json")
        self.assertIn("not JSON", r.json()["error"])
        self.assertEqual(self.client.get(self.url("link_tag", "nothing")).status_code, 404)
        self.assertEqual(self.client.get(reverse("chalk:link_tags", args=["ck_" + "x" * 32])).status_code, 404)
        self.assertEqual(self.client.options(self.url("link_tags")).status_code, 204)
        self.assertEqual(self.client.delete(self.url("link_tag", "nothing")).json(), {"ok": True, "removed": False})

    def test_the_table_is_bounded(self):
        self.api()
        self.post(self.url("link_tags"), {"values": {f"t{i}": i for i in range(200)}})
        r = self.post(self.url("link_tags"), {"values": {"one-more": 1}})
        self.assertIn("already has 200 tags", r.json()["error"])
        for i in range(4):
            self.post(self.url("link_tags"), {"values": {f"t{n}": n + i + 1 for n in range(100)}})
        self.assertEqual(len(BoardLink.objects.get().log), 300)

    def test_the_lab_page_is_told_where_the_link_lives(self):
        self.assertIn(self.manage, self.client.get(reverse("chalk:lab", args=[self.board.id])).content.decode())
