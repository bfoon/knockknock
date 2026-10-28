"""The paired slide remote (hanns/remote.py): pairing over HTTP, and the
lock enforced on the deck socket."""

import json

from asgiref.sync import sync_to_async
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from django.contrib.auth import get_user_model
from django.test import TestCase, TransactionTestCase, override_settings

from hanns import remote
from hanns import screen as svc
from hanns.models import BigScreen, Deck, ScreenShare, Slide
from hanns.routing import websocket_urlpatterns

MEM = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}


def _setup(test):
    U = get_user_model()
    test.host = U.objects.create_user("rm-host", password="pw-pw-pw-123")
    test.screen = BigScreen.objects.create(owner=test.host, name="Hall 2")
    test.deck = Deck.objects.create(owner=test.host, code="RMTE01", title="Keynote")
    for i in range(4):
        Slide.objects.create(deck=test.deck, position=i, data={"els": []})
    test.deck.ensure_control_pin()
    test.share = ScreenShare.objects.create(screen=test.screen, deck=test.deck, status=ScreenShare.STATUS_LIVE)
    test.screen.current_share = test.share
    test.screen.save(update_fields=["current_share"])


def _pair(client, screen, name="Fatou's iPhone"):
    r = client.post("/hanns/screen/remote/pair/", json.dumps({"code": screen.share_code, "name": name}),
                    content_type="application/json")
    return r


def _host(client, screen, **body):
    return client.post(f"/hanns/screen/s/{screen.token}/remote/", json.dumps(body), content_type="application/json")


@override_settings(CHANNEL_LAYERS=MEM, STATICFILES_STORAGE="django.contrib.staticfiles.storage.StaticFilesStorage")
class PairingTests(TestCase):
    def setUp(self):
        _setup(self)

    def test_pair_approve_and_open_the_controller(self):
        self.assertEqual(self.client.get("/hanns/screen/remote/").status_code, 200)      # the pair page
        r = self.client.post("/hanns/screen/remote/pair/", json.dumps({"code": "000000", "name": "x"}),
                             content_type="application/json")
        self.assertEqual(r.status_code, 404)
        r = _pair(self.client, self.screen)
        self.assertEqual(r.status_code, 200, r.content)
        match = r.json()["match"]
        self.assertIn(remote.COOKIE, r.cookies)
        self.assertTrue(r.cookies[remote.COOKIE]["httponly"])
        # the control board + lobby see the request (and its symbol), never a hash
        st = svc.screen_state(self.screen)["remote"]
        self.assertEqual((st["pending"][0]["name"], st["pending"][0]["match"]), ("Fatou's iPhone", match))
        self.assertNotIn("hash", json.dumps(st))
        live = svc.screen_state(self.screen)["shares"][0]
        self.assertEqual(live["code"], "RMTE01")                                         # the board can reach the deck
        self.assertFalse(st["lock"])
        self.assertEqual(self.client.get("/hanns/screen/remote/status/").json()["state"], "pending")
        # host approves → paired + locked
        r = _host(self.client, self.screen, action="approve", id=st["pending"][0]["id"])
        self.assertEqual(r.status_code, 200, r.content)
        st = r.json()["state"]["remote"]
        self.assertEqual((st["device"]["name"], st["lock"], st["pending"]), ("Fatou's iPhone", True, []))
        s = self.client.get("/hanns/screen/remote/status/").json()
        self.assertEqual((s["state"], s["deck"], s["screen"]), ("paired", "RMTE01", "Hall 2"))
        # the phone now gets the full controller for the deck on the screen
        page = self.client.get("/hanns/screen/remote/")
        self.assertContains(page, "Slide remote")
        self.assertContains(page, "remote:")
        self.assertNotContains(page, self.deck.control_pin)                              # never the deck PIN

    def test_no_deck_on_screen_waits(self):
        r = _pair(self.client, self.screen)
        _host(self.client, self.screen, action="approve", id=svc.screen_state(self.screen)["remote"]["pending"][0]["id"])
        self.screen.current_share = None
        self.screen.save(update_fields=["current_share"])
        page = self.client.get("/hanns/screen/remote/")
        self.assertContains(page, "Ready when the slides are")
        self.assertEqual(self.client.get("/hanns/screen/remote/status/").json()["deck"], None)

    def test_deny_unpair_forget_lock(self):
        _pair(self.client, self.screen)
        rid = svc.screen_state(self.screen)["remote"]["pending"][0]["id"]
        self.assertEqual(_host(self.client, self.screen, action="lock", lock=True).status_code, 400)   # nothing paired
        _host(self.client, self.screen, action="deny", id=rid)
        self.assertEqual(self.client.get("/hanns/screen/remote/status/").json()["state"], "denied")
        self.assertEqual(_host(self.client, self.screen, action="approve", id=rid).status_code, 400)   # gone
        _pair(self.client, self.screen)                                                  # asks again
        rid = svc.screen_state(self.screen)["remote"]["pending"][0]["id"]
        _host(self.client, self.screen, action="approve", id=rid)
        r = _host(self.client, self.screen, action="lock", lock=False)
        self.assertFalse(r.json()["state"]["remote"]["lock"])
        self.assertFalse(remote.locks_for_deck("RMTE01"))
        _host(self.client, self.screen, action="lock", lock=True)
        self.assertEqual(remote.locks_for_deck("RMTE01"), {str(self.screen.id): "Hall 2"})
        self.client.post("/hanns/screen/remote/forget/")                                 # the phone lets go
        self.assertIsNone(svc.screen_state(self.screen)["remote"]["device"])
        self.assertEqual(self.client.get("/hanns/screen/remote/status/").json()["state"], "unpaired")

    def test_one_remote_per_screen_and_request_limits(self):
        phones = [self.client_class() for _ in range(4)]
        for i, c in enumerate(phones[:3]):
            self.assertEqual(_pair(c, self.screen, f"P{i}").status_code, 200)
        self.assertEqual(_pair(phones[3], self.screen, "P3").status_code, 409)           # 3 waiting max
        pending = svc.screen_state(self.screen)["remote"]["pending"]
        self.assertEqual(len({p["match"]["word"] for p in pending}), 3)                  # all different symbols
        _host(self.client, self.screen, action="approve", id=pending[0]["id"])
        _host(self.client, self.screen, action="approve", id=pending[1]["id"])           # replaces the first
        self.assertEqual(phones[0].get("/hanns/screen/remote/status/").json()["state"], "unpaired")
        self.assertEqual(phones[1].get("/hanns/screen/remote/status/").json()["state"], "paired")

    def test_qr_and_stopped_screen(self):
        r = self.client.get(f"/hanns/screen/remote/qr.svg?code={self.screen.share_code}")
        self.assertEqual(r["Content-Type"], "image/svg+xml")
        self.assertIn(b"<svg", r.content)
        self.screen.is_active = False
        self.screen.save()
        self.assertEqual(_host(self.client, self.screen, action="unpair").status_code, 410)
        self.assertEqual(_pair(self.client, self.screen).status_code, 404)


@override_settings(CHANNEL_LAYERS=MEM)
class LockTests(TransactionTestCase):
    """The lock on the deck socket."""

    def setUp(self):
        _setup(self)
        self.secret, req = remote.request_pair(self.screen.id, "Remote")
        remote.host_action(self.screen.id, {"action": "approve", "id": req["id"]})

    async def _ws(self):
        c = WebsocketCommunicator(URLRouter(websocket_urlpatterns), "/ws/hanns/RMTE01/")
        ok, _ = await c.connect()
        self.assertTrue(ok)
        await c.receive_json_from()                                       # the snapshot
        return c

    async def _msgs(self, c):
        out = []
        while not await c.receive_nothing(timeout=0.25):
            out.append(await c.receive_json_from())
        return out

    async def _slide(self):
        d = await sync_to_async(Deck.objects.get)(code="RMTE01")
        return d.current_slide

    async def _hello(self, pin):
        c = await self._ws()
        await c.send_json_to({"type": "controller_hello", "pin": pin})
        return c, await self._msgs(c)

    async def test_only_the_remote_drives_while_locked(self):
        pin = await sync_to_async(lambda: Deck.objects.get(code="RMTE01").control_pin)()
        phone, hello = await self._hello(pin)
        ok = next(m for m in hello if m["type"] == "controller_ok")
        self.assertEqual((ok["remote"], ok["locked_by"]), (False, "Hall 2"))
        rem, hello = await self._hello("remote:" + self.secret)
        ok = next(m for m in hello if m["type"] == "controller_ok")
        self.assertEqual((ok["remote"], ok["locked_by"]), (True, ""))

        await phone.send_json_to({"type": "goto", "index": 2})          # refused, snapped back
        got = await self._msgs(phone)
        self.assertIn("controller_locked", [m["type"] for m in got])
        self.assertEqual(next(m for m in got if m["type"] == "goto")["index"], 0)
        self.assertEqual(await self._slide(), 0)

        await rem.send_json_to({"type": "goto", "index": 3})            # the remote moves the room
        await self._msgs(rem)
        self.assertEqual(await self._slide(), 3)
        self.assertEqual(next(m for m in await self._msgs(phone) if m["type"] == "goto")["index"], 3)

        # lock off → the PIN phone drives again, and hears it
        await sync_to_async(remote.host_action)(self.screen.id, {"action": "lock", "lock": False})
        await sync_to_async(svc.push_lock_changed)(await sync_to_async(BigScreen.objects.get)(pk=self.screen.pk))
        self.assertIn("controller_unlocked", [m["type"] for m in await self._msgs(phone)])
        await phone.send_json_to({"type": "goto", "index": 1})
        await self._msgs(phone)
        self.assertEqual(await self._slide(), 1)
        await phone.disconnect(); await rem.disconnect()

    async def test_wrong_secret_and_unpair_kick_the_remote(self):
        bad, hello = await self._hello("remote:" + "x" * 40)
        self.assertIn("controller_denied", [m["type"] for m in hello])
        rem, _ = await self._hello("remote:" + self.secret)
        await sync_to_async(remote.host_action)(self.screen.id, {"action": "unpair"})
        await sync_to_async(svc.push_lock_changed)(await sync_to_async(BigScreen.objects.get)(pk=self.screen.pk))
        self.assertIn("controller_denied", [m["type"] for m in await self._msgs(rem)])
        await rem.send_json_to({"type": "goto", "index": 2})
        await self._msgs(rem)
        self.assertEqual(await self._slide(), 0)
        await bad.disconnect(); await rem.disconnect()

    async def test_presenters_and_the_screen_frame(self):
        laptop = await self._ws()
        await laptop.send_json_to({"type": "presenter_hello"})
        await self._msgs(laptop)
        await laptop.send_json_to({"type": "goto", "index": 2})         # a presenter laptop is refused too
        self.assertIn("controller_locked", [m["type"] for m in await self._msgs(laptop)])
        self.assertEqual(await self._slide(), 0)
        frame = await self._ws()
        await frame.send_json_to({"type": "presenter_hello", "screen": self.screen.token, "share": str(self.share.id)})
        await self._msgs(frame)
        await frame.send_json_to({"type": "goto", "index": 1, "resync": True})   # the screen's own stage may resync
        await self._msgs(frame)
        self.assertEqual(await self._slide(), 1)
        await frame.send_json_to({"type": "goto", "index": 3})          # … but not drive
        await self._msgs(frame)
        self.assertEqual(await self._slide(), 1)
        fake = await self._ws()                                          # a made-up screen token buys nothing
        await fake.send_json_to({"type": "presenter_hello", "screen": "nope", "share": str(self.share.id)})
        await fake.send_json_to({"type": "goto", "index": 3, "resync": True})
        await self._msgs(fake)
        self.assertEqual(await self._slide(), 1)
        for c in (laptop, frame, fake):
            await c.disconnect()

    async def test_control_board_always_drives(self):
        """The host's fallback: the screen's token drives the deck on that screen,
        lock or no lock — and nothing else."""
        host, hello = await self._hello("screen:" + self.screen.token)
        ok = next(m for m in hello if m["type"] == "controller_ok")
        self.assertEqual((ok["host"], ok["locked_by"]), (True, ""))       # locked, but not for the host
        await host.send_json_to({"type": "goto", "index": 2})
        await self._msgs(host)
        self.assertEqual(await self._slide(), 2)
        # the remote's phone hears the move and keeps working too
        rem, _ = await self._hello("remote:" + self.secret)
        await rem.send_json_to({"type": "goto", "index": 3})
        await self._msgs(rem)
        self.assertEqual(await self._slide(), 3)
        self.assertEqual(next(m for m in await self._msgs(host) if m["type"] == "goto")["index"], 3)
        # unpaired / lock off: the board still drives
        await sync_to_async(remote.host_action)(self.screen.id, {"action": "unpair"})
        await host.send_json_to({"type": "goto", "index": 0})
        await self._msgs(host)
        self.assertEqual(await self._slide(), 0)
        await host.disconnect(); await rem.disconnect()

    async def test_control_board_token_is_narrow(self):
        for pin in ("screen:", "screen:not-a-token"):
            c, hello = await self._hello(pin)
            self.assertIn("controller_denied", [m["type"] for m in hello])
            await c.disconnect()
        # another screen's token, or this screen once the deck is off it
        other = await sync_to_async(BigScreen.objects.create)(owner=self.host, name="Hall 3")
        c, hello = await self._hello("screen:" + other.token)
        self.assertIn("controller_denied", [m["type"] for m in hello])
        await c.disconnect()
        await sync_to_async(BigScreen.objects.filter(pk=self.screen.pk).update)(current_share=None)
        c, hello = await self._hello("screen:" + self.screen.token)
        self.assertIn("controller_denied", [m["type"] for m in hello])
        await c.disconnect()



class GotoDbTests(TestCase):
    """_goto_db() (one thread hop, one row) must equal the old
    _set_current_slide() + _slide() pair — including past the end."""

    def setUp(self):
        _setup(self)

    def _old(self, code, index):
        d = Deck.objects.filter(code=code).first()
        slides = list(d.slides.all()) if d else []
        if not slides:
            return {}
        return slides[max(0, min(int(index), len(slides) - 1))].as_dict()

    def test_same_as_before(self):
        from hanns.consumers import PresentConsumer
        c = PresentConsumer.__new__(PresentConsumer)
        c.code = "RMTE01"
        # reorder positions so ordering really matters
        for s, pos in zip(Slide.objects.filter(deck=self.deck).order_by("position"), (3, 1, 0, 2)):
            Slide.objects.filter(pk=s.pk).update(position=pos)
        for index in (0, 1, 2, 3, 4, 99):
            got = PresentConsumer.__dict__["_goto_db"].func(c, index)   # the real one, minus the thread hop
            self.assertEqual(got, self._old("RMTE01", index), index)
            self.assertEqual(Deck.objects.get(code="RMTE01").current_slide, index)   # stored as before (unclamped)
        c.code = "NOPE00"
        self.assertEqual(c._one_slide(0), {})                                       # no deck
        empty = Deck.objects.create(owner=self.host, code="EMPTY1", title="Empty")
        c.code = empty.code
        self.assertEqual(c._one_slide(3), {})                                       # no slides
