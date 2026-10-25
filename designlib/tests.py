import json

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse

from .models import MAX_PER_USER, DesignBookmark

CHART = [{"id": "c1", "type": "chart", "chartKind": "bar", "x": 0, "y": 0, "w": 300, "h": 200},
         {"id": "t1", "type": "text", "x": 10, "y": 210, "w": 280, "h": 40, "text": "Sales by quarter", "size": 24}]


class LibraryApiTests(TestCase):
    def setUp(self):
        U = get_user_model()
        self.me = U.objects.create_user("awa", password="pw-pw-pw-123")
        self.other = U.objects.create_user("lamin", password="pw-pw-pw-123")
        self.client.force_login(self.me)
        self.url = reverse("designlib:list")

    def post(self, url, body):
        return self.client.post(url, json.dumps(body), content_type="application/json")

    def save(self, **kw):
        body = {"name": "Sales chart", "els": CHART, "w": 300, "h": 250, "kind": "ai", "prompt": "a bar chart of sales",
                "tags": ["Chart", "Stats"], "color": "#facc15"}
        body.update(kw)
        return self.post(self.url, body)

    def test_save_and_list(self):
        r = self.save()
        self.assertEqual(r.status_code, 201, r.content)
        item = r.json()["item"]
        self.assertEqual((item["name"], item["kind"], item["w"], item["h"], item["tags"]), ("Sales chart", "ai", 300, 250, ["Chart", "Stats"]))
        self.assertEqual(item["prompt"], "a bar chart of sales")
        listed = self.client.get(self.url).json()["items"]
        self.assertEqual([i["id"] for i in listed], [item["id"]])

    def test_designs_are_private(self):
        mine = self.save().json()["item"]["id"]
        self.client.force_login(self.other)
        self.assertEqual(self.client.get(self.url).json()["items"], [])
        self.assertEqual(self.post(reverse("designlib:item", args=[mine]), {"name": "stolen"}).status_code, 404)
        self.assertEqual(self.post(reverse("designlib:delete", args=[mine]), {}).status_code, 404)
        self.assertTrue(DesignBookmark.objects.filter(pk=mine, name="Sales chart").exists())

    def test_needs_sign_in(self):
        self.client.logout()
        self.assertEqual(self.client.get(self.url).status_code, 302)

    def test_rejects_empty_or_junk(self):
        self.assertEqual(self.save(els=[]).status_code, 400)
        self.assertEqual(self.save(els=[{"no": "type"}]).status_code, 400)
        self.assertEqual(self.client.post(self.url, "not json", content_type="application/json").status_code, 400)

    def test_inline_images_are_stripped_and_tags_cleaned(self):
        big = "data:image/png;base64," + "A" * 10000
        r = self.save(els=[{"type": "image", "src": big, "x": 0, "y": 0, "w": 10, "h": 10}],
                      tags=["Chart", "chart", "<script>", "x" * 40, "Brand"])
        item = r.json()["item"]
        self.assertEqual(item["els"][0]["src"], "")
        self.assertEqual(item["tags"], ["Chart", "Brand"])

    def test_bad_colour_is_dropped_and_name_defaults(self):
        item = self.save(color="url(javascript:alert(1))", name="   ").json()["item"]
        self.assertEqual((item["color"], item["name"]), ("", "Untitled design"))

    def test_use_pin_rename_tags_and_delete(self):
        pk = self.save().json()["item"]["id"]
        u = reverse("designlib:item", args=[pk])
        item = self.post(u, {"use": True}).json()["item"]
        self.assertEqual(item["uses"], 1)
        self.assertIsNotNone(item["lastUsed"])
        item = self.post(u, {"pinned": True, "name": "Q-chart", "tags": ["Brand"]}).json()["item"]
        self.assertEqual((item["pinned"], item["name"], item["tags"]), (True, "Q-chart", ["Brand"]))
        self.assertEqual(self.post(reverse("designlib:delete", args=[pk]), {}).json()["ok"], True)
        self.assertFalse(DesignBookmark.objects.filter(pk=pk).exists())

    def test_pinned_designs_come_first(self):
        a = self.save(name="A").json()["item"]["id"]
        b = self.save(name="B").json()["item"]["id"]
        self.post(reverse("designlib:item", args=[a]), {"pinned": True})
        ids = [i["id"] for i in self.client.get(self.url).json()["items"]]
        self.assertEqual(ids[0], a)

    def test_library_size_limit(self):
        DesignBookmark.objects.bulk_create([DesignBookmark(owner=self.me, name=f"d{i}", els=CHART) for i in range(MAX_PER_USER)])
        r = self.save()
        self.assertEqual(r.status_code, 400)
        self.assertIn("full", r.json()["error"])
