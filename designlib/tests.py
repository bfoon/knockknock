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


class BackgroundsAndTemplatesTests(TestCase):
    def setUp(self):
        self.me = get_user_model().objects.create_user("fatou", password="pw-pw-pw-123")
        self.client.force_login(self.me)
        self.url = reverse("designlib:list")

    def post(self, body):
        return self.client.post(self.url, json.dumps(body), content_type="application/json")

    def test_background_bookmark(self):
        r = self.post({"kind": "background", "name": "Sunset", "w": 960, "h": 540, "tags": ["Warm"],
                       "payload": {"bg": "linear-gradient(135deg,#f97316,#be123c)", "bgFx": "aurora", "palette": ["#f97316", "#be123c", "nope"],
                                   "tone": 0.31, "bgMode": "linear", "junk": {"x": 1}}})
        self.assertEqual(r.status_code, 201, r.content)
        item = r.json()["item"]
        self.assertEqual(item["kind"], "background")
        self.assertEqual(item["els"], [])
        self.assertEqual(item["payload"]["bgFx"], "aurora")
        self.assertEqual(item["payload"]["palette"], ["#f97316", "#be123c"])
        self.assertNotIn("junk", item["payload"])

    def test_ai_art_background_keeps_its_media_url(self):
        bg = 'url("/media/hanns/decks/AB/ai/x.svg") center / cover no-repeat, linear-gradient(135deg,#111,#333)'
        item = self.post({"kind": "background", "name": "AI art", "payload": {"bg": bg}}).json()["item"]
        self.assertEqual(item["payload"]["bg"], bg)

    def test_unsafe_css_is_refused(self):
        for bad in ("expression(alert(1))", "url(javascript:alert(1))", "red; </style><script>"):
            self.assertEqual(self.post({"kind": "background", "payload": {"bg": bad}}).status_code, 400, bad)
        self.assertEqual(self.post({"kind": "background", "payload": {"bg": ""}}).status_code, 400)

    def test_background_set_needs_two_or_more(self):
        one = {"kind": "bgset", "payload": {"variants": [{"bg": "#111", "role": "Title"}]}}
        self.assertEqual(self.post(one).status_code, 400)
        three = {"kind": "bgset", "name": "Aurora family", "payload": {"variants": [
            {"bg": "#111", "role": "Title"}, {"bg": "#222", "role": "Content"}, {"bg": "#333", "role": "Closing", "text": "#ffffff"}]}}
        item = self.post(three).json()["item"]
        self.assertEqual([v["role"] for v in item["payload"]["variants"]], ["Title", "Content", "Closing"])

    def test_template_bookmark_strips_pasted_images(self):
        big = "data:image/png;base64," + "B" * 9000
        slide = {"bg": "#0f172a", "bgFx": "none", "transition": "zoom", "els": [
            {"id": "a", "type": "text", "text": "Title here", "x": 60, "y": 40, "w": 600, "h": 80, "size": 60},
            {"id": "b", "type": "image", "src": big, "x": 600, "y": 120, "w": 300, "h": 300},
            {"no": "type"}]}
        item = self.post({"kind": "template", "name": "Hero split", "w": 960, "h": 540, "payload": {"slide": slide}}).json()["item"]
        tpl = item["payload"]["slide"]
        self.assertEqual((tpl["transition"], len(tpl["els"])), ("zoom", 2))
        self.assertEqual(tpl["els"][1]["src"], "")
        self.assertEqual(item["els"], [])

    def test_kinds_are_listed_together(self):
        self.post({"kind": "background", "name": "A", "payload": {"bg": "#111"}})
        self.post({"kind": "template", "name": "B", "payload": {"slide": {"bg": "#222", "els": []}}})
        kinds = sorted(i["kind"] for i in self.client.get(self.url).json()["items"])
        self.assertEqual(kinds, ["background", "template"])
