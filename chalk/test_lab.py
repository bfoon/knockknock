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
        src = "".join(p.read_text() for p in sorted(js_dir.glob("lab_parts*.js"))) + (js_dir / "lab_wireless.js").read_text()
        js = set(re.findall(r'\badd\("([a-z0-9_]+)",', src)) - {"breadboard_half", "breadboard_full"}
        modules = set(re.findall(r"^\s{4}(soil|gas|sound|flame|ir):\s*\{ name:", src, re.M))
        js |= {"mod_" + m for m in modules}
        self.assertEqual(js, set(lab_ai.CATALOG), "lab_ai.CATALOG and lab_parts*.js disagree")


def board_and_body():
    """A circuit board and a 3-D body, as the browser saves them."""
    return {
        "pcb": {
            "v": 1, "w": 60.96, "h": 40.64, "r": 3, "holes": True, "sig": "p_uno:31|x",
            "place": {"p_r": {"x": 10.16, "y": 7.62, "rot": 1}, "ghost": {"x": 1, "y": 1, "rot": 0}},
            "tracks": [{"n": 0, "l": 1, "w": 0.4, "pts": [[10.16, 7.62], [10.16, 12.7], [15.24, 12.7]]},
                       {"n": 0, "l": 0, "w": 0.4, "pts": [[1, 1]]},
                       {"n": "x", "l": 7, "w": 99, "pts": [[0, 0], ["a", 1], [2, 2]]}],
            "vias": [[10.16, 12.7, 0], "nope"], "open": [[1, 2, 3, 4], [1, 2]],
            "evil": "<script>",
        },
        "body": {
            "v": 1, "kind": "car", "wall": 2, "split": "z", "splitZ": 44, "drive": "wheels", "wheel": 50, "track": 100,
            "bay": {"x": 0, "y": 0, "z": 12, "w": 80, "d": 60, "h": 30},
            "anchors": {"motorL": [-30, 20, 25], "led": [[60, 20, 30], "bad"], "junk": [1, 2, 3]},
            "solids": [
                {"id": "s_hull", "name": "Body <b>shell</b>", "shape": "carbody", "x": 0, "y": 0, "z": 40, "sx": 150, "sy": 80,
                 "sz": 50, "rx": 0, "ry": 0, "rz": 0, "color": "#e2574c", "op": "add", "group": "hull"},
                {"id": "s_w1", "name": "Wheel", "shape": "wheel", "x": 40, "y": 50, "z": 25, "sx": 50, "sy": 20, "sz": 50,
                 "color": "#2a2f35", "op": "add", "group": "part", "role": "wheelL"},
                {"id": "s_cut", "name": "Axle", "shape": "cyl", "x": 40, "y": 0, "z": 25, "sx": 3.4, "sy": 3.4, "sz": 120,
                 "rx": 90, "op": "cut", "group": "hull"},
                {"id": "s_bad", "name": "Teapot", "shape": "teapot", "x": 0, "y": 0, "z": 0, "sx": 1, "sy": 1, "sz": 1},
                {"id": "s_big", "name": "Huge", "shape": "box", "x": 9e9, "y": 0, "z": 0, "sx": 9e9, "sy": 1, "sz": 1},
            ],
            "mounts": {"@board": {"x": 0, "y": 0, "z": 15, "rz": 90}, "p_led": {"x": 1, "y": 2, "z": 3},
                       "p_gone": {"x": 0, "y": 0, "z": 0}},
        },
    }


class StudioSaveTests(LabTestCase):
    """The circuit board, the 3-D body, and what the component list sets."""

    def test_board_and_body_are_kept_and_cleaned(self):
        r = self.save({"title": "Car", "data": circuit(**board_and_body())})
        self.assertEqual(r.status_code, 200, r.content)
        data = BoardCircuit.objects.get().data
        pcb, body = data["pcb"], data["body"]
        self.assertEqual(pcb["place"], {"p_r": {"x": 10.16, "y": 7.62, "rot": 1}})   # only parts that exist
        self.assertEqual(len(pcb["tracks"]), 2)                                       # a one-point track is not a track
        self.assertEqual(pcb["tracks"][1], {"n": 0, "l": 0, "w": 5, "pts": [[0.0, 0.0], [2.0, 2.0]]})
        self.assertEqual(pcb["vias"], [[10.16, 12.7, 0]])
        self.assertEqual(pcb["open"], [[1.0, 2.0, 3.0, 4.0]])
        self.assertNotIn("evil", pcb)
        self.assertEqual([s["id"] for s in body["solids"]], ["s_hull", "s_w1", "s_cut", "s_big"])
        self.assertEqual(body["solids"][0]["name"], "Body bshell/b")
        self.assertEqual(body["solids"][1]["role"], "wheelL")
        self.assertEqual(body["solids"][2]["op"], "cut")
        self.assertEqual(body["solids"][3]["x"], 2000)
        self.assertEqual(body["solids"][3]["sx"], 1000)
        self.assertEqual(sorted(body["mounts"]), ["@board", "p_led"])
        self.assertEqual(body["mounts"]["@board"]["rz"], 90)
        self.assertEqual(body["anchors"], {"motorL": [-30.0, 20.0, 25.0], "led": [[60.0, 20.0, 30.0]]})
        self.assertEqual((body["kind"], body["drive"], body["split"], body["wheel"]), ("car", "wheels", "z", 50))

    def test_a_circuit_without_them_saves_as_before(self):
        self.save({"title": "Plain", "data": circuit()})
        data = BoardCircuit.objects.get().data
        self.assertNotIn("pcb", data)
        self.assertNotIn("body", data)

    def test_junk_in_their_place_is_dropped_not_fatal(self):
        r = self.save({"title": "Odd", "data": circuit(pcb="nope", body={"solids": "nope"})})
        self.assertEqual(r.status_code, 200, r.content)
        data = BoardCircuit.objects.get().data
        self.assertNotIn("pcb", data)
        self.assertNotIn("body", data)

    def test_names_hide_and_lock_from_the_component_list(self):
        doc = circuit()
        doc["parts"][1].update(name="Headlight <i>resistor</i>" + "x" * 80, hide=True, lock=1)
        doc["parts"][2].update(name=42, hide=0)
        self.save({"title": "Named", "data": doc})
        parts = BoardCircuit.objects.get().data["parts"]
        self.assertEqual(parts[1]["name"], ("Headlight iresistor/i" + "x" * 80)[:40])
        self.assertTrue(parts[1]["hide"] and parts[1]["lock"])
        self.assertNotIn("name", parts[2])
        self.assertNotIn("hide", parts[2])
        self.assertNotIn("name", parts[0])

    def test_it_round_trips_to_the_page(self):
        self.save({"title": "Car", "data": circuit(**board_and_body())})
        r = self.client.get(reverse("chalk:lab", args=[self.board.id]))
        self.assertContains(r, "lab_pcb.js")
        self.assertContains(r, "lab_body_view.js")
        self.assertContains(r, 'id="lab-space"')
        cfg = json.loads(re.search(r'id="lab-config"[^>]*>(.*?)</script>', r.content.decode(), re.S).group(1))
        self.assertEqual(cfg["data"]["body"]["kind"], "car")
        self.assertEqual(cfg["data"]["pcb"]["w"], 60.96)


@override_settings(CHANNEL_LAYERS=IN_MEMORY, STORAGES=PLAIN_STATIC)
class ProjectAITests(LabTestCase):
    def ask(self, payload):
        return self.client.post(reverse("chalk:lab_ai", args=[self.board.id]),
                                data=json.dumps(payload), content_type="application/json")

    def test_a_whole_project_comes_back_cleaned(self):
        fake = {
            "reply": "A car.", "code": "void setup(){}\nvoid loop(){}",
            "circuit": {"parts": [{"id": "u", "type": "arduino_uno"}, {"id": "m", "type": "motor"}, {"id": "x", "type": "warp_drive"}],
                        "wires": [{"a": "u.D5", "b": "m.1"}]},
            "body": {"kind": "car", "color": "#112233", "wall": 99, "drive": "wheels",
                     "solids": [{"name": "Spoiler", "shape": "wedge", "is": "attach", "x": -60, "y": 0, "z": 70, "sx": 20, "sy": 70, "sz": 8},
                                {"name": "<img>", "shape": "box", "is": "nonsense", "x": "left", "sx": 1e12},
                                {"name": "Kettle", "shape": "kettle"}, "junk"]},
        }
        with mock.patch("hanns.ai.is_enabled", return_value=True), \
             mock.patch("hanns.ai.ai_json", return_value=(fake, "m")) as call:
            r = self.ask({"kind": "project", "question": "a toy car", "mode": "pro", "circuit": {"parts": [], "nets": []}})
        self.assertEqual(r.status_code, 200, r.content)
        j = r.json()
        self.assertEqual([p["type"] for p in j["circuit"]["parts"]], ["arduino_uno", "motor"])
        body = j["body"]
        self.assertEqual((body["kind"], body["color"], body["wall"], body["drive"]), ("car", "#112233", 4, "wheels"))
        self.assertEqual([s["shape"] for s in body["solids"]], ["wedge", "box"])
        self.assertEqual(body["solids"][1], {"name": "img", "shape": "box", "is": "attach", "x": 0, "y": 0, "z": 20,
                                             "sx": 600, "sy": 30, "sz": 30, "rx": 0, "ry": 0, "rz": 0})
        prompt = call.call_args[0][1]
        self.assertIn("BODY FORMAT", prompt)
        self.assertIn("PART CATALOG", prompt)
        self.assertIn("nmos", prompt)
        self.assertIn("hc05", prompt)                      # Bluetooth and radio parts are on offer
        self.assertIn("SoftwareSerial bt(10, 11)", prompt)
        self.assertIn("rf_rx", prompt)

    def test_a_body_is_sized_to_the_electronics(self):
        with mock.patch("hanns.ai.is_enabled", return_value=True), \
             mock.patch("hanns.ai.ai_json", return_value=({"reply": "ok", "body": {"kind": "custom", "solids": []},
                                                           "circuit": {"parts": [{"id": "u", "type": "arduino_uno"}]}}, "m")) as call:
            r = self.ask({"kind": "body", "question": "a lighthouse", "circuit": {"parts": [], "nets": [], "electronics": {"w": 99, "d": 84, "h": 18}}})
        j = r.json()
        self.assertEqual(j["body"]["kind"], "box")          # nothing to hold the electronics: a plain case instead
        self.assertIn("99 x 84 x 18 mm", call.call_args[0][1])
        self.assertNotIn("PART CATALOG", call.call_args[0][1])

    def test_wiring_a_part_into_the_circuit_is_cleaned(self):
        fake = {
            "reply": "- D9 to the resistor, because a pin gives 5 V.", "code": "const int LED = 9;\n" * 40,
            "circuit": {"parts": [{"id": "x", "type": "led"}]},
            "wiring": {
                "parts": [{"id": "r9", "type": "resistor", "props": {"ohms": 220, "evil": 1}},
                          {"id": "p_uno", "type": "resistor"},            # may not reuse an id from the bench
                          {"id": "u2", "type": "arduino_uno"},            # may not add a second board
                          {"id": "zz", "type": "tractor_beam"}],
                "wires": [{"a": "p_uno.D9", "b": "r9.1", "color": "white"},
                          {"a": "r9.2", "b": "p_led.A"},
                          {"a": "p_led.K", "b": "p_uno.GND1", "color": "black"},
                          {"a": "p_led.K", "b": "p_uno.D99"},             # no such pin
                          {"a": "ghost.A", "b": "p_uno.5V"},              # no such part
                          {"a": "u2.5V", "b": "p_led.A"},
                          {"a": "p_led.A", "b": "p_led.A"}],
            },
        }
        bench = {"parts": [{"id": "p_uno", "type": "arduino_uno"}, {"id": "p_led", "type": "led"}, {"id": "p_odd", "type": "nope"}],
                 "nets": []}
        with mock.patch("hanns.ai.is_enabled", return_value=True), \
             mock.patch("hanns.ai.ai_json", return_value=(fake, "m")) as call:
            r = self.ask({"kind": "wire", "selected": "p_led", "question": "wire it", "mode": "pro", "circuit": bench})
        self.assertEqual(r.status_code, 200, r.content)
        j = r.json()
        self.assertEqual(j["wiring"]["parts"], [{"id": "r9", "type": "resistor", "props": {"ohms": 220}}])
        self.assertEqual(j["wiring"]["wires"], [{"a": "p_uno.D9", "b": "r9.1", "color": "white"}, {"a": "r9.2", "b": "p_led.A"},
                                                {"a": "p_led.K", "b": "p_uno.GND1", "color": "black"}])
        self.assertNotIn("circuit", j)
        self.assertLessEqual(len(j["code"].split("\n")), 21)
        prompt = call.call_args[0][1]
        self.assertIn("SELECTED: p_led", prompt)
        self.assertIn("220 ohm", prompt)
        self.assertIn("PART CATALOG", prompt)

    def test_wiring_with_nothing_usable_is_left_out(self):
        with mock.patch("hanns.ai.is_enabled", return_value=True), \
             mock.patch("hanns.ai.ai_json", return_value=({"reply": "hm", "wiring": {"wires": [{"a": "a.b", "b": "c.d"}]}}, "m")):
            r = self.ask({"kind": "wire", "selected": "<script>", "circuit": {"parts": []}})
        self.assertNotIn("wiring", r.json())

    def test_other_questions_never_carry_a_body(self):
        with mock.patch("hanns.ai.is_enabled", return_value=True), \
             mock.patch("hanns.ai.ai_json", return_value=({"reply": "ok", "body": {"kind": "car"}}, "m")):
            r = self.ask({"kind": "explain", "question": "?", "circuit": {}})
        self.assertNotIn("body", r.json())


class StudioCatalogueTests(TestCase):
    """The shapes and ready-made bodies exist three times — in the browser,
    in what is saved, and in what the AI is told. They must agree."""

    def test_shapes_and_bodies_match_the_javascript(self):
        js_dir = Path(settings.BASE_DIR) / "static" / "chalk" / "js" / "lab"
        solid = (js_dir / "lab_solid.js").read_text()
        shapes = set(re.findall(r'(\w+): "', re.search(r"S\.SHAPES = \{(.*?)\};", solid, re.S).group(1)))
        self.assertEqual(shapes, set(lab_ai.SHAPES))
        self.assertEqual(shapes, lab.SHAPES)
        bodies = set(re.findall(r"^  T\.(\w+) = \{", (js_dir / "lab_body.js").read_text(), re.M)) | {"custom"}
        self.assertEqual(bodies, set(lab_ai.BODY_KINDS))
        self.assertEqual(bodies, lab.BODY_KINDS)
        for word in lab_ai.SHAPES:
            self.assertIn(word, lab_ai.BODY_FORMAT)


class ProjectShelfTests(TestCase):
    """The worked projects live in the browser; the page has to load them."""

    def test_the_shelf_is_served_and_stocked(self):
        js_dir = Path(settings.BASE_DIR) / "static" / "chalk" / "js" / "lab"
        src = (js_dir / "lab_projects.js").read_text()
        ids = re.findall(r'^  add\("([a-z0-9_]+)", "', src, re.M)
        self.assertGreaterEqual(len(ids), 60)
        self.assertEqual(len(ids), len(set(ids)))
        self.assertGreaterEqual(len([i for i in ids if i.startswith("bt_")]), 8)
        self.assertGreaterEqual(len([i for i in ids if i.startswith(("radio_", "fob_"))]), 8)
        bodies = set(re.findall(r'^  add\("[a-z0-9_]+", "[^"]+", "[^"]+", "([a-z]+)",', src, re.M))
        self.assertTrue(bodies <= set(lab_ai.BODY_KINDS), bodies - set(lab_ai.BODY_KINDS))
        page = (Path(settings.BASE_DIR) / "templates" / "chalk" / "lab.html").read_text()
        self.assertIn("lab_projects.js", page)
        self.assertLess(page.index("lab_studio.js"), page.index("lab_app.js"))
        self.assertLess(page.index("lab_projects.js"), page.index("lab_app.js"))
