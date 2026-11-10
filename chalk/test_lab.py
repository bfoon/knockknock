"""Circuit Lab: storage, permissions, AI plumbing and pinning to the board."""

import io
import json
import re
from pathlib import Path
from unittest import mock

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse

from . import lab, lab_ai
from .models import Board, BoardCircuit, BoardImage, BoardPage

User = get_user_model()

IN_MEMORY = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
# Pages render without collectstatic having been run.
PLAIN_STATIC = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}


def circuit(**extra):
    doc = {
        "v": 1, "mode": "pro",
        "parts": [
            {"id": "p_uno", "type": "arduino_uno", "x": 0, "y": 0, "rot": 0, "props": {}},
            {"id": "p_r", "type": "resistor", "x": 640, "y": 40, "rot": 1, "props": {"ohms": 220}},
            {"id": "p_led", "type": "led", "x": 700, "y": 40, "props": {"color": "red"}},
        ],
        "wires": [{"id": "w_1", "a": {"ref": "p_uno:D13"}, "b": {"ref": "p_r:1"}, "color": "#ef8a1f", "pts": [[600, 100]]}],
        "code": "void setup(){}\nvoid loop(){}\n",
        "prog": "code",
        "blocks": None,
        "view": {"x": 10, "y": 20, "z": 1.2},
    }
    doc.update(extra)
    return doc


def png(w=40, h=30):
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (w, h), (30, 60, 70)).save(buf, format="PNG")
    return SimpleUploadedFile("circuit.png", buf.getvalue(), content_type="image/png")


@override_settings(CHANNEL_LAYERS=IN_MEMORY, STORAGES=PLAIN_STATIC)
class LabTestCase(TestCase):
    def setUp(self):
        cache.clear()
        self.owner = User.objects.create_user("teacher", password="pw")
        self.other = User.objects.create_user("nosy", password="pw")
        self.board = Board.objects.create(owner=self.owner, title="Year 8 electronics")
        self.board.ensure_page(0)
        self.board.ensure_session()
        self.client.force_login(self.owner)

    def save(self, payload, user=None):
        if user:
            self.client.force_login(user)
        return self.client.post(reverse("chalk:lab_save", args=[self.board.id]),
                                data=json.dumps(payload), content_type="application/json")


class PageTests(LabTestCase):
    def test_owner_gets_the_lab(self):
        r = self.client.get(reverse("chalk:lab", args=[self.board.id]))
        self.assertEqual(r.status_code, 200)
        self.assertContains(r, 'id="lab-config"')
        self.assertContains(r, "lab_sim.js")
        cfg = json.loads(re.search(r'id="lab-config"[^>]*>(.*?)</script>', r.content.decode(), re.S).group(1))
        self.assertIsNone(cfg["circuitId"])
        self.assertEqual(cfg["saveUrl"], reverse("chalk:lab_save", args=[self.board.id]))

    def test_someone_elses_board_is_a_404(self):
        self.client.force_login(self.other)
        self.assertEqual(self.client.get(reverse("chalk:lab", args=[self.board.id])).status_code, 404)

    def test_signed_out_is_sent_to_log_in(self):
        self.client.logout()
        r = self.client.get(reverse("chalk:lab", args=[self.board.id]))
        self.assertEqual(r.status_code, 302)

    def test_opens_the_most_recent_circuit(self):
        c = BoardCircuit.objects.create(board=self.board, title="Night light", data=circuit())
        r = self.client.get(reverse("chalk:lab", args=[self.board.id]))
        self.assertContains(r, "Night light")
        self.assertContains(r, str(c.id))

    def test_a_circuit_from_another_board_is_not_reachable(self):
        mine = Board.objects.create(owner=self.owner, title="Other")
        c = BoardCircuit.objects.create(board=mine, title="Elsewhere", data=circuit())
        r = self.client.get(reverse("chalk:lab_open", args=[self.board.id, c.id]))
        self.assertEqual(r.status_code, 404)

    def test_stage_links_to_the_lab(self):
        r = self.client.get(reverse("chalk:stage", args=[self.board.id]))
        self.assertContains(r, reverse("chalk:lab", args=[self.board.id]))


class SaveTests(LabTestCase):
    def test_first_save_creates_then_updates(self):
        r = self.save({"title": "Blink", "data": circuit()})
        self.assertEqual(r.status_code, 200, r.content)
        cid = r.json()["id"]
        self.assertEqual(r.json()["url"], reverse("chalk:lab_open", args=[self.board.id, cid]))
        c = BoardCircuit.objects.get(pk=cid)
        self.assertEqual(c.title, "Blink")
        self.assertEqual(c.part_count, 3)
        self.assertEqual(c.data["wires"][0]["pts"], [[600.0, 100.0]])

        r = self.save({"id": cid, "title": "Blink faster", "data": circuit(mode="kid")})
        self.assertEqual(r.status_code, 200)
        c.refresh_from_db()
        self.assertEqual((c.title, c.mode), ("Blink faster", "kid"))
        self.assertEqual(BoardCircuit.objects.count(), 1)

    def test_beacon_form_payload_is_accepted(self):
        r = self.client.post(reverse("chalk:lab_save", args=[self.board.id]),
                             {"payload": json.dumps({"title": "On close", "data": circuit()})})
        self.assertEqual(r.status_code, 200, r.content)

    def test_cannot_write_to_another_teachers_board(self):
        r = self.save({"title": "x", "data": circuit()}, user=self.other)
        self.assertEqual(r.status_code, 404)

    def test_cannot_overwrite_a_circuit_on_a_different_board(self):
        other_board = Board.objects.create(owner=self.owner, title="B2")
        c = BoardCircuit.objects.create(board=other_board, title="Keep", data=circuit())
        r = self.save({"id": str(c.id), "title": "Hijack", "data": circuit()})
        self.assertEqual(r.status_code, 404)
        c.refresh_from_db()
        self.assertEqual(c.title, "Keep")

    def test_rejects_bad_documents(self):
        bad = [
            "not a dict",
            circuit(parts=[{"id": "has space", "type": "led", "x": 0, "y": 0}]),
            circuit(parts=[{"id": "p1", "type": "<script>", "x": 0, "y": 0}]),
            circuit(parts=[{"id": "p1", "type": "led", "x": float("inf"), "y": 0}]) if False else circuit(parts=[{"id": "p1", "type": "led", "x": "far", "y": 0}]),
            circuit(parts=[{"id": "p1", "type": "led", "x": 0, "y": 0}, {"id": "p1", "type": "led", "x": 0, "y": 0}]),
            circuit(parts=[{"id": "p%d" % i, "type": "led", "x": 0, "y": 0} for i in range(lab.MAX_PARTS + 1)]),
            circuit(code="x" * (lab.MAX_CODE + 1)),
            circuit(wires=[{"id": "w1", "a": {}, "b": {"ref": "p_r:1"}}]),
        ]
        for doc in bad:
            r = self.save({"title": "bad", "data": doc})
            self.assertEqual(r.status_code, 400, doc if not isinstance(doc, dict) else list(doc)[:3])
        self.assertEqual(BoardCircuit.objects.count(), 0)

    def test_cleaning_strips_what_it_does_not_know(self):
        doc = circuit()
        doc["parts"][1]["props"] = {"ohms": 330, "onclick": "alert(1)" * 20, "Bad Key": 1, "nested": {"a": 1}}
        doc["wires"][0]["color"] = "javascript:alert(1)"
        doc["wires"][0]["a"]["ref"] = "p_uno:D13\"><svg>"
        doc["wires"][0]["a"]["x"] = 1
        doc["wires"][0]["a"]["y"] = 2
        doc["evil"] = True
        out = lab.clean_circuit(doc)
        self.assertEqual(out["parts"][1]["props"], {"ohms": 330})
        self.assertEqual(out["wires"][0]["color"], "#e8c22a")
        self.assertNotIn("ref", out["wires"][0]["a"])
        self.assertNotIn("evil", out)

    def test_programs_and_workshop_data_survive_cleaning(self):
        doc = circuit()
        doc["parts"].append({"id": "p_nano", "type": "arduino_nano", "x": 0, "y": 600})
        doc["parts"].append({"id": "p_pb", "type": "perfboard", "x": 900, "y": 0})
        doc["parts"][2]["cutPins"] = ["K", "bad pin!"]
        doc["wires"][0]["cut"] = 0.4
        doc["programs"] = {
            "p_uno": {"code": "void setup(){}\nvoid loop(){}\n", "prog": "code"},
            "p_nano": {"code": "void setup(){}\nvoid loop(){}\n", "prog": "blocks", "blocks": {"loop": []}},
            "p_ghost": {"code": "x"},
        }
        doc["current"] = "p_nano"
        doc["joints"] = {"p_pb:a1": 1, "p_pb:a2": 0.4, "p_pb:a3": 7, "nope:a1": 1}
        doc["cuts"] = {"p_pb:c5": True, "p_pb:<x>": True}
        doc["bridges"] = [["p_pb:a1", "p_pb:a2"], ["p_pb:a1"], ["evil", "p_pb:a2"]]
        out = lab.clean_circuit(doc)
        self.assertEqual(set(out["programs"]), {"p_uno", "p_nano"})
        self.assertEqual(out["current"], "p_nano")
        self.assertEqual(out["joints"], {"p_pb:a1": 1.0, "p_pb:a2": 0.4})
        self.assertEqual(out["cuts"], {"p_pb:c5": 1})
        self.assertEqual(out["bridges"], [["p_pb:a1", "p_pb:a2"]])
        self.assertEqual(out["parts"][2]["cutPins"], ["K"])
        self.assertEqual(out["wires"][0]["cut"], 0.4)

    def test_delete(self):
        c = BoardCircuit.objects.create(board=self.board, title="Bye", data=circuit())
        r = self.client.post(reverse("chalk:lab_delete", args=[self.board.id, c.id]))
        self.assertEqual(r.status_code, 200)
        self.assertFalse(BoardCircuit.objects.exists())

    def test_deleting_a_board_takes_its_circuits(self):
        BoardCircuit.objects.create(board=self.board, title="Gone too", data=circuit())
        self.board.delete()
        self.assertFalse(BoardCircuit.objects.exists())


class AITests(LabTestCase):
    def ask(self, payload):
        return self.client.post(reverse("chalk:lab_ai", args=[self.board.id]),
                                data=json.dumps(payload), content_type="application/json")

    def test_without_a_key_says_so(self):
        with mock.patch("hanns.ai.is_enabled", return_value=False):
            r = self.ask({"kind": "explain", "question": "?", "circuit": {}})
        self.assertEqual(r.status_code, 503)
        self.assertIn("GEMINI_API_KEY", r.json()["error"])

    def test_answer_is_cleaned_against_the_catalogue(self):
        fake = {
            "reply": "Put a resistor in front of the LED.",
            "highlights": ["p_led", "not-a-part"],
            "code": "void setup(){}\nvoid loop(){}",
            "circuit": {
                "parts": [
                    {"id": "u1", "type": "arduino_uno", "x": 0, "y": 0},
                    {"id": "r1", "type": "resistor", "props": {"ohms": 220, "evil": "x"}},
                    {"id": "z1", "type": "flux_capacitor"},
                    {"id": "l1", "type": "led", "props": {"color": "green"}},
                ],
                "wires": [
                    {"a": "u1.D13", "b": "r1.1", "color": "orange"},
                    {"a": "r1.2", "b": "l1.A"},
                    {"a": "l1.K", "b": "u1.GND1", "color": "black"},
                    {"a": "l1.K", "b": "u1.NOPE"},
                    {"a": "z1.1", "b": "u1.5V"},
                ],
            },
        }
        with mock.patch("hanns.ai.is_enabled", return_value=True), \
             mock.patch("hanns.ai.ai_json", return_value=(fake, "gemini-flash-latest")) as call:
            r = self.ask({"kind": "build", "question": "an LED on pin 13", "mode": "pro",
                          "circuit": {"parts": [{"id": "p_led", "type": "led"}], "nets": []}})
        self.assertEqual(r.status_code, 200, r.content)
        j = r.json()
        self.assertEqual(j["highlights"], ["p_led"])
        self.assertEqual([p["type"] for p in j["circuit"]["parts"]], ["arduino_uno", "resistor", "led"])
        self.assertEqual(j["circuit"]["parts"][1]["props"], {"ohms": 220})
        self.assertEqual(len(j["circuit"]["wires"]), 3)
        system, prompt = call.call_args[0][:2]
        self.assertIn("ONE JSON object", system)
        self.assertIn("PART CATALOG", prompt)
        self.assertIn("arduino_uno", prompt)

    def test_kid_voice_is_asked_for(self):
        with mock.patch("hanns.ai.is_enabled", return_value=True), \
             mock.patch("hanns.ai.ai_json", return_value=({"reply": "Yay!"}, "m")) as call:
            self.ask({"kind": "explain", "question": "what does it do", "mode": "kid", "circuit": {}})
        self.assertIn("Sparky", call.call_args[0][0])

    def test_editing_code_sends_the_program_selection_and_errors(self):
        code = "void setup() {\n  pinMode(13, OUTPUT)\n}\nvoid loop() {}\n"
        fixed = "void setup() {\n  pinMode(13, OUTPUT);\n}\nvoid loop() {}\n"
        with mock.patch("hanns.ai.is_enabled", return_value=True), \
             mock.patch("hanns.ai.ai_json", return_value=({"reply": "Added the missing ;", "code": fixed}, "m")) as call:
            r = self.ask({"kind": "fixcode", "question": "", "mode": "pro", "code": code,
                          "selection": {"from": 2, "to": 2}, "errors": [{"line": 2, "msg": "Missing ; at the end of this line."}],
                          "circuit": {}})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["code"], fixed)
        prompt = call.call_args[0][1]
        self.assertIn("  2|   pinMode(13, OUTPUT)", prompt)
        self.assertIn("SELECTION: lines 2-2", prompt)
        self.assertIn("line 2: Missing ;", prompt)
        self.assertIn("16-bit", prompt)

    def test_blocks_come_back_bounded(self):
        deep = {"t": "repeat", "f": {"n": "2"}, "c": []}
        node = deep
        for _ in range(30):
            child = {"t": "repeat", "f": {"n": "2"}, "c": []}
            node["c"].append(child)
            node = child
        fake = {"reply": "Blinks OUT 1", "blocks": {"setup": [], "loop": [deep, {"t": "write", "f": {"pin": "3", "hl": "1" * 900}}]}}
        with mock.patch("hanns.ai.is_enabled", return_value=True), \
             mock.patch("hanns.ai.ai_json", return_value=(fake, "m")) as call:
            r = self.ask({"kind": "blocks", "question": "blink OUT 1", "mode": "kid", "circuit": {}})
        self.assertEqual(r.status_code, 200)
        blocks = r.json()["blocks"]
        self.assertLessEqual(len(blocks["loop"][1]["f"]["hl"]), 200)
        self.assertLess(len(json.dumps(blocks)), 20000)
        self.assertIn("BLOCK FORMAT", call.call_args[0][1])
        self.assertIn("SECONDS", call.call_args[0][1])

    @override_settings(CHALK_LAB_AI_HOURLY_LIMIT=2)
    def test_hourly_limit(self):
        with mock.patch("hanns.ai.is_enabled", return_value=True), \
             mock.patch("hanns.ai.ai_json", return_value=({"reply": "ok"}, "m")):
            codes = [self.ask({"kind": "ask", "question": "hi", "circuit": {}}).status_code for _ in range(3)]
        self.assertEqual(codes, [200, 200, 429])

    def test_engine_errors_are_passed_on_politely(self):
        from hanns import ai as hai

        with mock.patch("hanns.ai.is_enabled", return_value=True), \
             mock.patch("hanns.ai.ai_json", side_effect=hai.AIError("Gemini's free quota is used up", status=429)):
            r = self.ask({"kind": "ask", "question": "hi", "circuit": {}})
        self.assertEqual(r.status_code, 429)
        self.assertIn("quota", r.json()["error"])

    def test_other_teachers_cannot_spend_your_quota(self):
        self.client.force_login(self.other)
        with mock.patch("hanns.ai.is_enabled", return_value=True):
            self.assertEqual(self.ask({"kind": "ask", "question": "hi"}).status_code, 404)


@override_settings(MEDIA_ROOT="/tmp/chalk-lab-test-media")
class PinTests(LabTestCase):
    def test_pins_a_picture_to_the_current_page_and_tells_the_room(self):
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        layer = get_channel_layer()
        channel = async_to_sync(layer.new_channel)()
        code = self.board.session.code
        async_to_sync(layer.group_add)(f"chalk_{code}", channel)

        r = self.client.post(reverse("chalk:lab_pin", args=[self.board.id]), {"file": png(400, 300), "title": "Blink"})
        self.assertEqual(r.status_code, 200, r.content)
        page = BoardPage.objects.get(board=self.board, index=0)
        self.assertEqual(len(page.els), 1)
        el = page.els[0]
        self.assertEqual(el["type"], "image")
        self.assertTrue(el["src"].endswith("/"))
        self.assertAlmostEqual(el["x"] + el["w"] / 2, 0.5, places=3)
        self.assertEqual(page.history[-1]["op"], "add")
        self.assertEqual(BoardImage.objects.filter(board=self.board).count(), 1)

        msg = async_to_sync(layer.receive)(channel)
        self.assertEqual(msg["payload"]["t"], "el_add")
        self.assertEqual(msg["payload"]["el"]["id"], el["id"])

    def test_tall_pictures_are_kept_on_the_board(self):
        self.client.post(reverse("chalk:lab_pin", args=[self.board.id]), {"file": png(100, 400)})
        el = BoardPage.objects.get(board=self.board, index=0).els[0]
        self.assertLessEqual(el["h"], 0.9001)
        self.assertGreaterEqual(el["y"], 0)

    def test_not_a_picture(self):
        bogus = SimpleUploadedFile("x.png", b"PK\x03\x04 not really", content_type="image/png")
        r = self.client.post(reverse("chalk:lab_pin", args=[self.board.id]), {"file": bogus})
        self.assertEqual(r.status_code, 400)
        self.assertFalse(BoardImage.objects.exists())

    def test_only_the_owner_can_pin(self):
        self.client.force_login(self.other)
        r = self.client.post(reverse("chalk:lab_pin", args=[self.board.id]), {"file": png()})
        self.assertEqual(r.status_code, 404)


class CatalogueTests(TestCase):
    """lab_ai.CATALOG is the server's copy of the parts drawer. If a part is
    added to the JavaScript and not here, the AI can't use it — and if it is
    here but not there, the AI will design with a part that doesn't exist."""

    def test_matches_the_javascript(self):
        js_dir = Path(settings.BASE_DIR) / "static" / "chalk" / "js" / "lab"
        src = "".join(p.read_text() for p in sorted(js_dir.glob("lab_parts*.js")))
        js = set(re.findall(r'\badd\("([a-z0-9_]+)",', src)) - {"breadboard_half", "breadboard_full"}
        modules = set(re.findall(r"^\s{4}(soil|gas|sound|flame|ir):\s*\{ name:", src, re.M))
        js |= {"mod_" + m for m in modules}
        self.assertEqual(js, set(lab_ai.CATALOG), "lab_ai.CATALOG and lab_parts*.js disagree")
