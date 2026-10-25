"""Hanns AI Studio — whole-deck waves, custom instructions and the AI area tool.

The model is never called: `ai_json` is replaced by a scripted stand-in that
records what it was sent, so these tests check what reaches the model and
what comes back, deterministically.
"""

import json
import shutil
import tempfile
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.urls import reverse

from . import ai, ai_fallback
from .models import Deck

TMP_MEDIA = tempfile.mkdtemp(prefix="hanns-test-media-")


def slide(n, words=40):
    """A realistic slide: title, body, two shapes and a chart."""
    return {"id": f"s{n}", "bg": "linear-gradient(135deg,#111,#333)", "els": [
        {"id": f"t{n}", "type": "text", "x": 60, "y": 40, "w": 820, "h": 90, "text": f"Slide {n} title about the harvest",
         "font": "Archivo", "size": 64, "weight": 800, "color": "#ffffff", "anim": "rise"},
        {"id": f"b{n}", "type": "text", "x": 60, "y": 160, "w": 520, "h": 260, "text": " ".join(["word"] * words),
         "font": "Inter", "size": 24, "color": "#e2e8f0"},
        {"id": f"r{n}", "type": "rect", "x": 600, "y": 160, "w": 300, "h": 300, "fill": "rgba(255,255,255,.1)", "radius": 20},
        {"id": f"e{n}", "type": "ellipse", "x": 820, "y": 20, "w": 120, "h": 120, "fill": "#f472b6"},
        {"id": f"c{n}", "type": "chart", "chartKind": "bar", "x": 620, "y": 180, "w": 260, "h": 260, "title": "Yield"},
    ]}


def deck_payload(n):
    return [{"index": i, "slide": slide(i)} for i in range(n)]


class FakeModel:
    """Answers like the model would: one result per slide it was sent."""

    def __init__(self, guide="Titles Archivo 64/800 white; body Inter 24."):
        self.calls = []
        self.guide = guide

    def __call__(self, system, user, temperature=0.9, max_tokens=8192):
        self.calls.append({"system": system, "user": user})
        body = user.split("SLIDES:\n", 1)[1] if "SLIDES:\n" in user else "[]"
        digests = json.loads(body)
        out = []
        for d in digests:
            out.append({"index": d["index"], "els": [{"id": d["els"][0].get("id"), "color": "#facc15"}],
                        "notes": f"Notes for {d['index']}", "add": [], "remove": []})
        return {"slides": out, "guide": self.guide}, "fake-model"


class WaveTests(TestCase):
    def test_a_twenty_slide_deck_is_split_into_waves_that_fit(self):
        digests, pending = ai.take_wave(deck_payload(20))
        self.assertTrue(1 <= len(digests) <= ai.WAVE_MAX)
        self.assertEqual(len(digests) + len(pending), 20)
        self.assertLessEqual(len(json.dumps(digests)), ai.WAVE_CHARS + 4000)
        self.assertEqual(pending[0], len(digests))               # the rest, in order

    def test_one_huge_slide_still_goes_through(self):
        big = [{"index": 0, "slide": slide(0, words=3000)}]
        digests, pending = ai.take_wave(big)
        self.assertEqual((len(digests), pending), (1, []))

    def test_defaults_are_dropped_from_digests(self):
        digests, _ = ai.take_wave([{"index": 0, "slide": {"els": [{"id": "a", "type": "rect", "x": 1, "y": 2, "w": 3, "h": 4, "rot": 0, "stroke": "none"}]}}])
        self.assertNotIn("rot", digests[0]["els"][0])
        self.assertNotIn("stroke", digests[0]["els"][0])

    def test_whole_deck_polish_covers_every_slide_across_waves(self):
        """Simulates the browser loop: keep sending `pending` until done."""
        fake = FakeModel()
        done, guide, todo = {}, "", list(range(20))
        with mock.patch.object(ai, "ai_json", fake):
            while todo:
                batch = todo[:5]
                res, _ = ai.action_polish({"slides": [{"index": i, "slide": slide(i)} for i in batch], "guide": guide})
                for r in res["slides"]:
                    done[r["index"]] = r
                guide = guide or res["guide"]
                todo = res["pending"] + todo[5:]
        self.assertEqual(sorted(done), list(range(20)))
        # every later wave was told the style guide from the first one
        self.assertNotIn("DECK STYLE GUIDE", fake.calls[0]["user"])
        self.assertTrue(all("DECK STYLE GUIDE" in c["user"] for c in fake.calls[1:]))
        # and no request was truncated mid-JSON any more
        for c in fake.calls:
            json.loads(c["user"].split("SLIDES:\n", 1)[1])

    def test_notes_and_animate_also_wave(self):
        with mock.patch.object(ai, "ai_json", FakeModel()):
            res, _ = ai.action_notes({"slides": deck_payload(12)})
            self.assertEqual(len(res["slides"]) + len(res["pending"]), 12)
            res, _ = ai.action_animate({"slides": deck_payload(12)})
            self.assertEqual(len(res["slides"]) + len(res["pending"]), 12)

    def test_fallback_designer_no_longer_stops_at_twenty(self):
        res = ai_fallback.fb_animate({"slides": deck_payload(24)})
        self.assertEqual(len(res["slides"]), 24)


class EditTests(TestCase):
    def test_custom_instruction_reaches_the_model_with_ids(self):
        fake = FakeModel()
        with mock.patch.object(ai, "ai_json", fake):
            res, _ = ai.action_edit({"prompt": "make every title gold", "slides": deck_payload(3)})
        self.assertIn("INSTRUCTION: make every title gold", fake.calls[0]["user"])
        self.assertIn('"id": "t0"', fake.calls[0]["user"])
        self.assertEqual([r["index"] for r in res["slides"]], [0, 1, 2])

    def test_edit_needs_an_instruction_and_slides(self):
        with self.assertRaises(ai.AIError):
            ai.run("edit", {"prompt": "", "slides": deck_payload(1)}, "ABC123", use_ai=False)
        with self.assertRaises(ai.AIError):
            ai.run("edit", {"prompt": "make it pop", "slides": []}, "ABC123", use_ai=False)

    def test_without_ai_a_custom_instruction_explains_itself(self):
        with self.assertRaises(ai.AIError) as e:
            ai.run("edit", {"prompt": "translate to French", "slides": deck_payload(2)}, "ABC123", use_ai=False)
        self.assertIn("need the AI", str(e.exception))


@override_settings(MEDIA_ROOT=TMP_MEDIA)
class RegionTests(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(TMP_MEDIA, ignore_errors=True)

    def _ask(self, answer, **extra):
        p = {"prompt": "a bar chart of sales", "region": {"x": 500, "y": 140, "w": 380, "h": 300},
             "slide": slide(0), "mode": "auto"}
        p.update(extra)
        with mock.patch.object(ai, "ai_json", lambda *a, **k: (answer, "fake-model")):
            return ai.action_region(p, "ABC123")[0]

    def test_region_elements_come_back_with_the_box(self):
        res = self._ask({"els": [{"type": "chart", "chartKind": "bar", "x": 510, "y": 150, "w": 360, "h": 280}], "caption": "Sales chart"})
        self.assertEqual(res["region"], {"x": 500, "y": 140, "w": 380, "h": 300})
        self.assertEqual(res["caption"], "Sales chart")
        self.assertEqual(res["els"][0]["chartKind"], "bar")

    def test_illustrations_are_sanitised_and_saved(self):
        svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 380 300" onload="alert(1)">'
               '<script>alert(2)</script><circle cx="190" cy="150" r="90" fill="#f5b301"/>'
               '<image href="https://evil.example/x.png"/></svg>')
        res = self._ask({"els": [], "illustration": {"svg": svg, "alt": "a sun"}}, prompt="an illustration of the sun")
        self.assertTrue(res["image"]["url"].startswith("/"))
        from django.conf import settings
        from django.core.files.storage import default_storage
        with default_storage.open(res["image"]["url"].split(settings.MEDIA_URL, 1)[1]) as fh:
            saved = fh.read().decode()
        self.assertIn("<circle", saved)
        for bad in ("onload", "<script", "evil.example"):
            self.assertNotIn(bad, saved)
        self.assertEqual((res["image"]["w"], res["image"]["h"]), (380, 300))

    def test_the_prompt_tells_the_model_where_the_box_is(self):
        seen = {}
        def capture(system, user, **k):
            seen["system"], seen["user"] = system, user
            return {"els": [{"type": "text", "text": "Hi", "x": 500, "y": 140, "w": 200, "h": 60}]}, "fake"
        with mock.patch.object(ai, "ai_json", capture):
            ai.action_region({"prompt": "a quote", "region": {"x": 500, "y": 140, "w": 380, "h": 300},
                              "slide": slide(0), "mode": "design"}, "ABC123")
        self.assertIn("REGION: x=500, y=140, w=380, h=300", seen["system"])
        self.assertIn("elements only", seen["system"])
        self.assertIn('"id": "t0"', seen["user"])          # it can see what's already on the slide

    def test_tiny_or_missing_region_is_a_user_error(self):
        with self.assertRaises(ai.AIError) as e:
            ai.run("region", {"prompt": "x y", "region": {"x": 10, "y": 10, "w": 5, "h": 5}}, "ABC123")
        self.assertEqual(e.exception.status, 400)
        with self.assertRaises(ai.AIError):
            ai.run("region", {"prompt": "", "region": {"x": 10, "y": 10, "w": 300, "h": 200}}, "ABC123")

    def test_built_in_designer_fills_an_area_without_ai(self):
        base = {"region": {"x": 100, "y": 100, "w": 400, "h": 240}, "slide": slide(0)}
        chart, _, notice = ai.run("region", dict(base, prompt="a chart of sales growth"), "ABC123", use_ai=False)
        self.assertEqual(chart["els"][0]["type"], "chart")
        self.assertIn("built-in designer", notice)
        bullets, _, _ = ai.run("region", dict(base, prompt="bullet points: water, seeds, solar"), "ABC123", use_ai=False)
        self.assertIn("•", bullets["els"][0]["text"])
        art, _, _ = ai.run("region", dict(base, prompt="an illustration of a river"), "ABC123", use_ai=False)
        self.assertTrue(art["image"]["url"].startswith("/"))
        num, _, _ = ai.run("region", dict(base, prompt="big number 87% of farmers"), "ABC123", use_ai=False)
        self.assertEqual(num["els"][0]["text"], "87%")


@override_settings(CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}})
class JobQuotaTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = get_user_model().objects.create_user("presenter", password="pw-pw-pw-123")
        self.deck = Deck.objects.create(owner=self.user, code="WAVE01", title="Harvest")
        self.client.force_login(self.user)
        self.url = reverse("hanns:ai", args=[self.deck.code])

    def post(self, body):
        return self.client.post(self.url, json.dumps(body), content_type="application/json")

    def test_every_wave_of_one_job_costs_a_single_credit(self):
        with mock.patch.object(ai, "is_enabled", return_value=True), \
             mock.patch.object(ai, "ai_json", FakeModel()), \
             mock.patch.object(ai, "hourly_limit", return_value=40):
            lefts = []
            for wave in range(4):
                r = self.post({"action": "polish", "job": "job-abc", "slides": deck_payload(3)})
                self.assertEqual(r.status_code, 200, r.content)
                lefts.append(r.json()["quotaLeft"])
            self.assertEqual(lefts, [39, 39, 39, 39])
            r = self.post({"action": "polish", "job": "another-job", "slides": deck_payload(3)})
            self.assertEqual(r.json()["quotaLeft"], 38)
            r = self.post({"action": "polish", "slides": deck_payload(3)})       # no job id: normal charge
            self.assertEqual(r.json()["quotaLeft"], 37)

    def test_region_endpoint_end_to_end(self):
        answer = {"els": [{"type": "text", "text": "Hello", "x": 100, "y": 100, "w": 200, "h": 60}], "caption": "Greeting"}
        with mock.patch.object(ai, "is_enabled", return_value=True), \
             mock.patch.object(ai, "ai_json", lambda *a, **k: (answer, "fake-model")):
            r = self.post({"action": "region", "prompt": "a greeting", "region": {"x": 90, "y": 90, "w": 300, "h": 120},
                           "slide": slide(0), "mode": "design"})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["result"]["caption"], "Greeting")
