"""Power Lab: storage, permissions, AI plumbing — and that the Python
catalogues have not drifted from the JavaScript ones."""

import json
import re
from pathlib import Path
from unittest import mock

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.urls import reverse

from . import lab_ai, power, power_ai
from .models import Board, BoardPlan

User = get_user_model()
PLAIN_STATIC = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}
JS = Path(settings.BASE_DIR) / "static" / "chalk" / "js"


def plan(**extra):
    doc = {
        "v": 1,
        "parts": [
            {"id": "p1_pv", "type": "pv", "x": 60, "y": 60, "props": {"model": "p330", "shade": 0}},
            {"id": "p2_mppt", "type": "mppt", "x": 60, "y": 260, "props": {"amps": 40, "maxpv": 150}, "name": "Roof <b>controller</b>"},
            {"id": "p3_battery", "type": "battery", "x": 60, "y": 460, "props": {"volts": 12, "ah": 200, "chem": "agm"}},
        ],
        "wires": [
            {"id": "w1", "a": "p1_pv:+", "b": "p2_mppt:PV+", "mm2": 4, "len": 12},
            {"id": "w2", "a": "p1_pv:-", "b": "p2_mppt:PV-", "mm2": 4, "len": 12},
            {"id": "w3", "a": "p2_mppt:B+", "b": "p3_battery:+", "mm2": 16, "len": 1},
        ],
        "site": {"name": "Basse", "lat": 13.31, "tilt": 15, "az": 180, "month": 8, "cloud": -1, "dust": 10},
        "clock": 14.5, "tariff": 13.5, "prices": {"pv": 12000, "cable|4": 95}, "view": {"x": 0, "y": 0, "z": 1},
    }
    doc.update(extra)
    return doc


@override_settings(STORAGES=PLAIN_STATIC)
class PowerTestCase(TestCase):
    def setUp(self):
        cache.clear()
        self.owner = User.objects.create_user("teacher", password="pw")
        self.other = User.objects.create_user("nosy", password="pw")
        self.board = Board.objects.create(owner=self.owner, title="Form 3 physics")
        self.client.force_login(self.owner)

    def save(self, data, **extra):
        body = {"title": "Clinic solar", "data": data}
        body.update(extra)
        return self.client.post(reverse("chalk:power_save", args=[self.board.id]), json.dumps(body), content_type="application/json")


class CleanTests(TestCase):
    def test_round_trip_keeps_what_matters(self):
        out = power.clean_plan(plan())
        self.assertEqual([p["type"] for p in out["parts"]], ["pv", "mppt", "battery"])
        self.assertEqual(out["wires"][0], {"id": "w1", "a": "p1_pv:+", "b": "p2_mppt:PV+", "mm2": 4, "len": 12})
        self.assertEqual(out["site"]["name"], "Basse")
        self.assertEqual(out["site"]["month"], 8)
        self.assertEqual(out["prices"], {"pv": 12000, "cable|4": 95})
        self.assertEqual(out["clock"], 14.5)

    def test_names_lose_their_markup(self):
        out = power.clean_plan(plan())
        self.assertEqual(out["parts"][1]["name"], "Roof bcontroller/b")

    def test_a_cable_to_a_missing_part_is_dropped_not_fatal(self):
        doc = plan()
        doc["wires"].append({"id": "w9", "a": "ghost:L", "b": "p1_pv:+", "mm2": 4, "len": 1})
        self.assertEqual(len(power.clean_plan(doc)["wires"]), 3)

    def test_bad_numbers_are_repaired(self):
        doc = plan()
        doc["wires"][0].update({"mm2": 3.3, "len": 99999})
        doc["site"].update({"lat": 400, "month": 99, "tilt": "steep"})
        out = power.clean_plan(doc)
        self.assertEqual(out["wires"][0]["mm2"], 2.5)
        self.assertEqual(out["wires"][0]["len"], 500)
        self.assertEqual((out["site"]["lat"], out["site"]["month"], out["site"]["tilt"]), (65, 12, 15))

    def test_refuses_nonsense(self):
        for bad in (None, [], {"parts": "x"}, plan(parts=[{"id": "a b", "type": "pv"}]), plan(parts=[{"id": "ok", "type": "PV!"}]),
                    plan(wires=[{"id": "w1", "a": "p1_pv", "b": "p2_mppt:PV+"}])):
            with self.assertRaises(power.Invalid):
                power.clean_plan(bad)

    def test_limits(self):
        many = [{"id": f"p{i}", "type": "lamp", "x": 0, "y": 0} for i in range(power.MAX_PARTS + 1)]
        with self.assertRaises(power.Invalid):
            power.clean_plan(plan(parts=many, wires=[]))

    def test_a_hidden_fault_survives_a_save(self):
        out = power.clean_plan(plan(secret={"id": "p1_pv", "k": "fault", "was": "none", "say": "a broken <panel>", "v": "open"}))
        self.assertEqual(out["secret"], {"id": "p1_pv", "k": "fault", "say": "a broken panel", "was": "none"})
        self.assertNotIn("secret", power.clean_plan(plan(secret={"id": "ghost", "k": "fault"})))


class ViewTests(PowerTestCase):
    def test_page_renders_empty_and_with_a_plan(self):
        r = self.client.get(reverse("chalk:power", args=[self.board.id]))
        self.assertEqual(r.status_code, 200)
        self.assertContains(r, 'id="power-config"')
        self.assertContains(r, "power_app.js")
        saved = self.save(plan()).json()
        r = self.client.get(saved["url"])
        self.assertContains(r, "Clinic solar")

    def test_save_creates_then_updates(self):
        first = self.save(plan()).json()
        self.assertTrue(first["ok"])
        again = self.save(plan(clock=9), id=first["id"], title="Renamed").json()
        self.assertEqual(again["id"], first["id"])
        self.assertEqual(BoardPlan.objects.count(), 1)
        saved = BoardPlan.objects.get()
        self.assertEqual((saved.title, saved.data["clock"], saved.part_count), ("Renamed", 9, 3))

    def test_save_by_beacon(self):
        r = self.client.post(reverse("chalk:power_save", args=[self.board.id]), {"payload": json.dumps({"title": "T", "data": plan()})})
        self.assertTrue(r.json()["ok"])

    def test_bad_plan_is_a_400_with_a_reason(self):
        r = self.save({"parts": "no"})
        self.assertEqual(r.status_code, 400)
        self.assertIn("Couldn't save", r.json()["error"])

    def test_someone_else_cannot_read_write_or_delete(self):
        saved = self.save(plan()).json()
        self.client.force_login(self.other)
        self.assertEqual(self.client.get(reverse("chalk:power", args=[self.board.id])).status_code, 404)
        self.assertEqual(self.save(plan()).status_code, 404)
        self.assertEqual(self.client.post(reverse("chalk:power_delete", args=[self.board.id, saved["id"]])).status_code, 404)
        self.assertEqual(BoardPlan.objects.count(), 1)

    def test_anonymous_is_sent_to_log_in(self):
        self.client.logout()
        self.assertEqual(self.client.get(reverse("chalk:power", args=[self.board.id])).status_code, 302)

    def test_delete(self):
        saved = self.save(plan()).json()
        r = self.client.post(reverse("chalk:power_delete", args=[self.board.id, saved["id"]]))
        self.assertTrue(r.json()["ok"])
        self.assertEqual(BoardPlan.objects.count(), 0)

    def test_plan_from_another_board_is_not_found(self):
        other_board = Board.objects.create(owner=self.owner, title="Other")
        stray = BoardPlan.objects.create(board=other_board, title="Stray", data=plan())
        self.assertEqual(self.client.get(reverse("chalk:power_open", args=[self.board.id, stray.id])).status_code, 404)

    def test_board_pages_link_to_the_lab(self):
        self.assertContains(self.client.get(reverse("chalk:boards")), reverse("chalk:power", args=[self.board.id]))


class AITests(PowerTestCase):
    def ask(self, **body):
        return self.client.post(reverse("chalk:power_ai", args=[self.board.id]), json.dumps(body), content_type="application/json")

    def test_off_without_a_key(self):
        with mock.patch("chalk.power._ai_enabled", return_value=False):
            self.assertEqual(self.ask(kind="explain").status_code, 503)

    def test_design_returns_a_cleaned_spec(self):
        raw = {"reply": "A clinic.", "highlights": ["Q2", "<x>"], "spec": {
            "type": "hybrid", "site": "Basse", "autonomy": 2.2, "chem": "lfp",
            "loads": [{"app": "lamp", "qty": 8, "hours": 6}, {"app": "vaccine", "qty": 1}, {"app": "teleporter", "qty": 1},
                      {"app": "autoclave", "watts": 1500, "name": "<b>Autoclave</b>", "qty": 400}, "junk"]}}
        with mock.patch("chalk.power._ai_enabled", return_value=True), mock.patch("hanns.ai.ai_json", return_value=(raw, "m")) as call:
            r = self.ask(kind="design", question="a clinic in Basse", plan={"site": {"name": "Banjul"}}).json()
        self.assertTrue(r["ok"])
        self.assertEqual(r["highlights"], ["Q2"])
        self.assertEqual(r["spec"]["type"], "hybrid")
        self.assertEqual(r["spec"]["site"], {"name": "Basse"})
        self.assertEqual(r["spec"]["autonomy"], 2)
        self.assertEqual(r["spec"]["loads"], [{"qty": 8, "app": "lamp", "hours": 6.0}, {"qty": 1, "app": "vaccine"},
                                              {"qty": 40, "app": "custom", "watts": 1500.0, "name": "bAutoclave/b"}])
        self.assertIn("APPLIANCES", call.call_args[0][1])

    def test_questions_see_the_plan(self):
        with mock.patch("chalk.power._ai_enabled", return_value=True), mock.patch("hanns.ai.ai_json", return_value=({"reply": "Fine."}, "m")) as call:
            r = self.ask(kind="fix", question="?", plan={"parts": [{"ref": "PV1", "type": "pv"}], "findings": ["danger: no fuse"]}).json()
        self.assertEqual(r["reply"], "Fine.")
        self.assertNotIn("spec", r)
        self.assertIn("danger: no fuse", call.call_args[0][1])

    def test_a_part_to_print_goes_to_the_3d_tutor(self):
        raw = {"reply": "A bracket.", "circuit": {"parts": []}, "body": {"kind": "car", "color": "#112233", "solids": [
            {"shape": "box", "is": "hull", "x": 0, "y": 0, "z": 3, "sx": 80, "sy": 30, "sz": 6},
            {"shape": "cyl", "is": "cut", "x": 20, "y": 0, "z": 0, "sx": 4.5, "sy": 4.5, "sz": 30},
            {"shape": "teapot", "x": 0}]}}
        with mock.patch("chalk.power._ai_enabled", return_value=True), mock.patch("hanns.ai.ai_json", return_value=(raw, "m")) as call:
            r = self.ask(kind="part3d", question="a bracket").json()
        self.assertEqual(r["body"]["kind"], "custom")
        self.assertTrue(r["body"]["free"])
        self.assertEqual([s["is"] for s in r["body"]["solids"]], ["attach", "cut"])
        self.assertIn("free-standing object", call.call_args[0][1])

    def test_hourly_limit(self):
        with mock.patch("chalk.power._ai_enabled", return_value=True), mock.patch("hanns.ai.ai_json", return_value=({"reply": "ok"}, "m")), \
                override_settings(CHALK_LAB_AI_HOURLY_LIMIT=2):
            self.assertEqual([self.ask(kind="ask", question="q").status_code for _ in range(3)], [200, 200, 429])


class MakerAITests(TestCase):
    """The Circuit Lab's 3-D tutor: objects, edits and print advice."""

    BODY = {"kind": "custom", "solids": [{"id": "s_aaa", "name": "Base", "shape": "box"}, {"id": "s_bbb", "name": "Fin", "shape": "fin"}]}

    def test_edits_are_bounded_and_only_touch_real_shapes(self):
        ops = lab_ai.clean_bodyops([
            {"op": "set", "id": "s_aaa", "sx": 99999, "color": "#abcdef", "name": "<i>Big</i> base", "evil": 1},
            {"op": "set", "id": "s_zzz", "sx": 10}, {"op": "set", "id": "s_bbb"}, {"op": "remove", "id": "s_bbb"},
            {"op": "add", "solid": {"shape": "cyl", "is": "cut", "sx": 5, "sy": 5, "sz": 40}}, {"op": "add", "solid": {"shape": "teapot"}},
            {"op": "format-disk"}, "junk"], self.BODY)
        self.assertEqual(ops[0], {"op": "set", "id": "s_aaa", "sx": 600, "color": "#abcdef", "name": "iBig/i base"})
        self.assertEqual(ops[1], {"op": "remove", "id": "s_bbb"})
        self.assertEqual((ops[2]["op"], ops[2]["solid"]["shape"], ops[2]["solid"]["is"]), ("add", "cyl", "cut"))
        self.assertEqual(len(ops), 3)

    def test_edit_task_sends_the_body_and_returns_only_ops(self):
        raw = {"reply": "Longer.", "bodyops": [{"op": "set", "id": "s_aaa", "sx": 120}], "body": {"kind": "car"}, "code": "void setup(){}"}
        with mock.patch("hanns.ai.ai_json", return_value=(raw, "m")) as call:
            out = lab_ai.ask({"kind": "bodyedit", "question": "longer", "body": self.BODY})
        self.assertEqual(out["bodyops"], [{"op": "set", "id": "s_aaa", "sx": 120}])
        self.assertNotIn("body", out)
        self.assertNotIn("code", out)
        self.assertIn("s_aaa", call.call_args[0][1])
        self.assertIn("3-D design and printing tutor", call.call_args[0][0])

    def test_an_object_with_nothing_solid_is_refused(self):
        self.assertIsNone(lab_ai.clean_body({"solids": [{"shape": "cyl", "is": "cut"}]}, free=True))

    def test_print_coach_gets_the_measurements(self):
        with mock.patch("hanns.ai.ai_json", return_value=({"reply": "PETG."}, "m")) as call:
            out = lab_ai.ask({"kind": "printcoach", "report": {"pieces": [{"name": "Shell", "overhangCm2": 12}]}})
        self.assertEqual(out["reply"], "PETG.")
        self.assertIn('"overhangCm2":12', call.call_args[0][1])


class DriftTests(TestCase):
    """power_ai tells the AI what exists. If the browser's catalogue moves
    on without it, the AI designs with appliances the lab cannot draw."""

    def block(self, name):
        src = (JS / "power" / "power_core.js").read_text(encoding="utf-8")
        body = src.split(f"W.{name} = {{", 1)[1].split("\n  };", 1)[0]
        return {m.group(1): int(m.group(2)) for m in re.finditer(r'(\w+):\s*\{ name: "(?:[^"\\]|\\.)*", watts: (\d+)', body)}

    def test_appliances_match(self):
        js = {k: v for k, v in self.block("APPLIANCES").items() if k not in ("none", "custom")}
        self.assertEqual(js, power_ai.APPS)

    def test_dc_loads_match(self):
        js = {k: v for k, v in self.block("DC_LOADS").items() if k != "custom"}
        self.assertEqual(js, power_ai.DC_APPS)

    def test_sites_match(self):
        src = (JS / "power" / "power_sun.js").read_text(encoding="utf-8")
        self.assertEqual(tuple(re.findall(r"\{ name: \"([^\"]+)\", lat:", src)), power_ai.SITES)

    def test_every_script_the_page_loads_exists(self):
        html = (Path(settings.BASE_DIR) / "templates" / "chalk" / "power.html").read_text(encoding="utf-8")
        for path in re.findall(r"\{% static '([^']+\.(?:js|css))' %\}", html):
            self.assertTrue((Path(settings.BASE_DIR) / "static" / path).exists(), path)
