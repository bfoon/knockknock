"""The board studio on the server: designed parts, v2 boards, experiments,
and the AI's board changes. Run with the rest: python manage.py test chalk."""

import json
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse

from . import lab, lab_ai, parts
from .models import Board, BoardCircuit, ChalkPart


def footprint(n=8):
    return {"id": "SOIC-8", "name": "SOIC-8", "ref": "U", "kind": "smd",
            "pads": [{"n": str(i + 1), "x": -2.7 if i < n // 2 else 2.7, "y": (i % (n // 2)) * 1.27, "shape": "roundrect", "w": 1.55, "h": 0.6, "name": "P%d" % (i + 1)} for i in range(n)],
            "holes": [], "silk": [{"l": [-1.9, -2.6, 1.9, -2.6]}, {"c": [0, 0, 1]}, {"bogus": [1, 2]}],
            "body": {"x": 0, "y": 0, "w": 3.9, "h": 4.9, "z": 1.6, "shape": "box", "color": "#1d1f22", "look": "ic"},
            "court": {"x0": -3.7, "y0": -2.7, "x1": 3.7, "y1": 6.5}}


def part_data(**kw):
    d = {"name": "Comparator", "value": "LM393", "ref": "U", "cat": "Chips", "look": "ic", "color": "#123456", "desc": "a comparator",
         "fp": footprint(), "pins": {"1": {"name": "OUT", "type": "output"}, "4": {"name": "GND", "type": "ground"}},
         "behave": "R 1 4 10k\n"}
    d.update(kw)
    return d


class CleanPartTests(TestCase):
    def test_a_good_part_is_kept(self):
        out = parts.clean_part("cp_lm393", part_data())
        self.assertEqual(out["name"], "Comparator")
        self.assertEqual(len(out["fp"]["pads"]), 8)
        self.assertEqual(out["fp"]["pads"][0]["side"], "top")          # an SMD pad knows its side
        self.assertEqual(len(out["fp"]["silk"]), 2)                     # the unknown drawing is dropped
        self.assertEqual(out["pins"]["1"], {"name": "OUT", "type": "output"})

    def test_bad_types_and_shapes_are_refused(self):
        for t in ("lm393", "cp_", "cp_Has Spaces", "cp_" + "x" * 40, None):
            with self.assertRaises(parts.Invalid):
                parts.clean_part(t, part_data())
        with self.assertRaises(parts.Invalid):
            parts.clean_part("cp_x1", part_data(fp={"pads": []}))
        with self.assertRaises(parts.Invalid):
            parts.clean_part("cp_x1", part_data(behave="x" * (parts.MAX_BEHAVE + 1)))

    def test_text_cannot_carry_markup(self):
        out = parts.clean_part("cp_x1", part_data(name='<script>alert(1)</script>Chip', desc="a <b>bold</b> claim"))
        self.assertNotIn("<", out["name"] + out["desc"])
        self.assertEqual(parts.clean_part("cp_x1", part_data(color="red;background:url(x)"))["color"], "")

    def test_numbers_are_clamped(self):
        fp = footprint()
        fp["pads"][0].update({"x": 1e9, "w": -5, "drill": 99, "slot": [0.6, 2.0]})
        pad = parts.clean_part("cp_x1", part_data(fp=fp))["fp"]["pads"][0]
        self.assertEqual(pad["x"], 200)
        self.assertEqual(pad["w"], 0.05)
        self.assertEqual(pad["drill"], 20)
        self.assertEqual(pad["slot"], [0.6, 2.0])
        self.assertNotIn("side", pad)                                   # it has a hole now

    def test_lib_keeps_only_used_parts(self):
        lib = parts.clean_lib({"cp_a1": part_data(), "cp_b2": part_data(), "cp_bad": {"fp": {}}}, {"cp_a1", "cp_bad"})
        self.assertEqual(list(lib), ["cp_a1"])

    def test_sims(self):
        out = parts.clean_sims([{"name": "Blink", "src": "run 2s\x00"}, {"src": 5}, "nope"] + [{"src": "x"}] * 40)
        self.assertEqual(out[0], {"name": "Blink", "src": "run 2s"})
        self.assertEqual(len(out), parts.MAX_SIMS - 2)


class BoardV2Tests(TestCase):
    def circuit(self, pcb):
        return {"parts": [{"id": "p1", "type": "resistor", "x": 0, "y": 0}, {"id": "p2", "type": "cp_lm393", "x": 0, "y": 0}],
                "wires": [], "pcb": pcb, "lib": {"cp_lm393": part_data(), "cp_unused": part_data()}, "sims": [{"name": "t", "src": "run 1s"}]}

    def test_v2_board_round_trip(self):
        pcb = {"v": 2, "w": 50, "h": 50, "r": 0, "place": {"p1": {"x": 10, "y": 10, "rot": 1, "fp": "R_0805", "side": "bottom"}, "ghost": {"x": 1, "y": 1}},
               "tracks": [{"n": -1, "l": 1, "w": 0.3, "pts": [[1, 1], [5, 5]], "man": 1}], "vias": [[3, 3, 0, 1]],
               "shape": {"kind": "poly", "pts": [[0, 0], [50, 0], [25, 40]]}, "cut": [{"kind": "circle", "x": 25, "y": 15, "d": 5}, {"kind": "nope"}],
               "items": [{"id": "usb", "kind": "fp", "fp": "USB-C-16", "x": 25, "y": 35, "rot": 0, "names": ["GND"]},
                         {"id": "h1", "kind": "hole", "x": 5, "y": 5, "d": 3.2},
                         {"id": "z1", "kind": "zone", "layer": 1, "net": "GND", "pts": "board"},
                         {"id": "t1", "kind": "text", "x": 1, "y": 1, "s": "<hi>"},
                         {"id": "bad id!", "kind": "hole"}, {"id": "k1", "kind": "spaceship"}],
               "links": [{"a": "usb:A4", "b": "p1:1"}, {"a": "nobody:1", "b": "p1:2"}],
               "labels": {"usb:A1": "GND", "p1:2": "<x>", "ghost:1": "GND"},
               "rules": {"track": 0.25, "clear": 99, "evil": 1}, "mask": "#1b3f8f", "finish": "javascript:"}
        data = lab.clean_circuit(self.circuit(pcb))
        b = data["pcb"]
        self.assertEqual(b["v"], 2)
        self.assertEqual(b["place"]["p1"], {"x": 10.0, "y": 10.0, "rot": 1, "fp": "R_0805", "side": "bottom"})
        self.assertNotIn("ghost", b["place"])
        self.assertEqual(b["tracks"][0]["n"], -1)
        self.assertEqual(b["tracks"][0]["man"], 1)
        self.assertEqual(b["vias"][0], [3.0, 3.0, 0, 1])
        self.assertEqual(b["shape"]["kind"], "poly")
        self.assertEqual(len(b["cut"]), 1)
        self.assertEqual([i["id"] for i in b["items"]], ["usb", "h1", "z1", "t1"])
        self.assertEqual(b["items"][3]["s"], "hi")
        self.assertEqual(b["links"], [{"a": "usb:A4", "b": "p1:1"}])
        self.assertEqual(b["labels"], {"usb:A1": "GND"})
        self.assertEqual(b["rules"], {"track": 0.25, "clear": 2.0})
        self.assertEqual(b["mask"], "#1b3f8f")
        self.assertNotIn("finish", b)
        self.assertEqual(list(data["lib"]), ["cp_lm393"])
        self.assertEqual(data["sims"], [{"name": "t", "src": "run 1s"}])

    def test_a_v1_board_stays_v1(self):
        data = lab.clean_circuit({"parts": [{"id": "p1", "type": "resistor"}], "wires": [], "pcb": {"w": 40, "h": 30, "place": {"p1": {"x": 5, "y": 5, "rot": 0}}, "tracks": [], "vias": []}})
        self.assertEqual(data["pcb"]["v"], 1)
        self.assertNotIn("items", data["pcb"])


class PartsViewTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user("t", password="x")
        self.client.force_login(self.user)
        self.url = reverse("chalk:lab_parts")

    def post(self, body):
        return self.client.post(self.url, json.dumps(body), content_type="application/json")

    def test_save_list_update_delete(self):
        r = self.post({"type": "cp_lm393", "data": part_data()})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(ChalkPart.objects.get().category, "Chips")
        self.post({"type": "cp_lm393", "data": part_data(name="Renamed")})
        self.assertEqual(ChalkPart.objects.count(), 1)
        self.assertEqual(ChalkPart.objects.get().name, "Renamed")
        got = self.client.get(self.url).json()
        self.assertEqual(got["parts"][0]["type"], "cp_lm393")
        r = self.client.delete(self.url + "?type=cp_lm393")
        self.assertTrue(r.json()["deleted"])
        self.assertFalse(ChalkPart.objects.exists())

    def test_bad_part_is_refused(self):
        r = self.post({"type": "resistor", "data": part_data()})
        self.assertEqual(r.status_code, 400)
        self.assertIn("cp_", r.json()["error"])

    def test_parts_are_private(self):
        other = get_user_model().objects.create_user("o", password="x")
        ChalkPart.objects.create(owner=other, type="cp_theirs", name="Theirs", data=part_data())
        self.assertEqual(self.client.get(self.url).json()["parts"], [])
        self.client.delete(self.url + "?type=cp_theirs")
        self.assertTrue(ChalkPart.objects.filter(owner=other).exists())

    def test_login_required(self):
        self.client.logout()
        self.assertNotEqual(self.client.get(self.url).status_code, 200)

    def test_lab_page_hands_over_your_parts(self):
        ChalkPart.objects.create(owner=self.user, type="cp_mine", name="Mine", data=part_data())
        board = Board.objects.create(owner=self.user, title="B")
        r = self.client.get(reverse("chalk:lab", args=[board.id]))
        self.assertEqual(r.status_code, 200)
        cfg = r.context["config"]
        self.assertEqual(cfg["partsUrl"], self.url)
        self.assertEqual(cfg["parts"][0]["type"], "cp_mine")

    def test_a_circuit_carries_its_parts(self):
        board = Board.objects.create(owner=self.user, title="B")
        doc = {"parts": [{"id": "p1", "type": "cp_lm393"}], "wires": [], "lib": {"cp_lm393": part_data()}}
        r = self.client.post(reverse("chalk:lab_save", args=[board.id]), json.dumps({"title": "T", "data": doc}), content_type="application/json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(BoardCircuit.objects.get().data["lib"]["cp_lm393"]["value"], "LM393")


class DesignAITests(TestCase):
    def test_new_kinds_are_known(self):
        for k in ("pcb", "part", "behave", "scenario"):
            self.assertIn(k, lab_ai.KINDS)
            self.assertIn(k, lab_ai.TASKS)

    def test_prompts_carry_what_each_kind_needs(self):
        _, kind, prompt = lab_ai._prompt({"kind": "pcb", "question": "make it round", "board": {"size": [50, 40], "library": "USB-C-16 SOIC-8"}})
        self.assertEqual(kind, "pcb")
        self.assertIn("PCB ACTIONS", prompt)
        self.assertIn("LIBRARY (footprint ids):\n\nUSB-C-16 SOIC-8", prompt.replace("LIBRARY (footprint ids):\n\n", "LIBRARY (footprint ids):\n\n"))
        _, _, prompt = lab_ai._prompt({"kind": "behave", "question": "a comparator", "code": "R A B", "pins": [{"n": "1", "name": "IN"}]})
        self.assertIn("BEHAVIOUR LANGUAGE", prompt)
        self.assertIn("CURRENT BEHAVIOUR", prompt)
        self.assertNotIn("PROGRAM (line numbers", prompt)
        _, _, prompt = lab_ai._prompt({"kind": "scenario", "question": "press it", "refs": {"p1": "SW1"}})
        self.assertIn("SCENARIO LANGUAGE", prompt)
        self.assertIn('"p1":"SW1"', prompt)

    def test_board_actions_are_whitelisted(self):
        acts = lab_ai.clean_actions([
            {"do": "shape", "preset": "heart", "why": "<b>cute</b>"},
            {"do": "shape", "preset": "dodecahedron"},
            {"do": "place", "ref": "U1", "x": 1e9, "y": 5, "rot": 7, "side": "bottom"},
            {"do": "add", "fp": "USB-C-16", "x": 10, "y": 10, "ref": "J1<"},
            {"do": "add", "fp": "../../etc"},
            {"do": "link", "a": "J1.A4", "b": "U1.8"},
            {"do": "link", "a": "J1", "b": "U1.8"},
            {"do": "label", "pad": "new.A1", "net": "GND"},
            {"do": "rm -rf"}, "nope", {"do": "route"},
        ])
        self.assertEqual([a["do"] for a in acts], ["shape", "place", "add", "link", "label", "route"])
        self.assertEqual(acts[0]["why"], "bcute/b")
        self.assertEqual(acts[1]["x"], 500.0)
        self.assertEqual(acts[1]["rot"], 7)
        self.assertEqual(acts[2]["ref"], "J1")

    def test_part_spec_and_fences(self):
        spec = lab_ai.clean_part_spec({"name": "MCP23017", "package": "soic 28 wide", "pins": [{"n": 1, "name": "GPB0", "type": "bidir"}, {"n": "bad pin!", "name": "x"}],
                                       "behave": "```\nR VDD VSS 100k\n```", "look": "spaceship"})
        self.assertEqual(spec["pins"], [{"n": "1", "name": "GPB0", "type": "bidir"}])
        self.assertEqual(spec["behave"], "R VDD VSS 100k\n")
        self.assertEqual(spec["look"], "ic")

    def test_ask_cleans_design_answers(self):
        fake = {"reply": "Here.", "actions": [{"do": "route"}], "circuit": {"parts": [{"id": "x", "type": "led"}]}, "code": "void setup(){}", "scenario": "```\nrun 2s\n```"}
        with mock.patch("hanns.ai.ai_json", return_value=(fake, "m"), create=True):
            try:
                out = lab_ai.ask({"kind": "pcb", "question": "route it", "board": {}})
            except ImportError:
                self.skipTest("hanns isn't installed here")
        self.assertEqual(out["actions"], [{"do": "route"}])
        self.assertNotIn("circuit", out)
        self.assertNotIn("code", out)
        self.assertNotIn("scenario", out)
        out2 = lab_ai._clean(fake, {"kind": "scenario"})
        self.assertEqual(out2["scenario"], "run 2s\n")
