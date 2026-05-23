"""
hanns/consumers.py — WebSocket consumer for live Hanns presentations.

Plug into your existing ASGI routing alongside the Boardly + poll consumers:

    # project routing
    from hanns.consumers import PresentConsumer
    websocket_urlpatterns += [
        re_path(r"ws/hanns/(?P<code>\\w+)/$", PresentConsumer.as_asgi()),
    ]

Mirrors boardly.BoardConsumer's shape (code from the URL kwarg, a per-deck
group, an is_presenter flag, fanout + send_json helpers, snapshot on
connect, @sync_to_async DB access). It is intentionally thin: the deck
content is edited over plain HTTP and lives in the DB, so the socket only
carries the two things that must be real-time —

Client → server:
    {type:"presenter_hello"}        the presenter/projector screen connected
    {type:"join", nick}             an audience phone joined
    {type:"react", emoji}           audience tapped an emoji
    {type:"goto", index}            presenter moved to slide <index>

Server → client (fanned out to the whole deck group):
    {type:"state", code, title,     full snapshot on connect: lets a phone
          current_slide,            render the reaction pad and sync to the
          allow_reactions,          slide the presenter is on
          live, count}
    {type:"reaction", emoji}        spawn a floating emoji on every screen
    {type:"goto", index}            audience follows the presenter's slide
    {type:"participants", count}    live audience headcount
"""

import json

from asgiref.sync import sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer


# A small allow-list so a malicious client can't inject arbitrary markup as
# an "emoji". Keep in sync with REACTIONS in hanns_present.js.
ALLOWED_REACTIONS = {
    "❤️", "👏", "🔥", "😂", "😮", "💯", "🎉", "👍", "✨", "🙌", "🤯", "💜",
}


class PresentConsumer(AsyncWebsocketConsumer):
    # ── lifecycle ────────────────────────────────────────────────────
    async def connect(self):
        self.code = self.scope["url_route"]["kwargs"]["code"].upper()
        self.group = f"hanns_{self.code}"
        self.nick = None
        self.is_presenter = False
        self.is_controller = False

        self.deck = await self._get_deck(self.code)
        if self.deck is None:
            await self.close()
            return

        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()

        # Snapshot so a (re)connecting phone can build its reaction pad and
        # sync to whatever slide the presenter is currently showing.
        await self.send_json(await self._snapshot())

    async def disconnect(self, code):
        if getattr(self, "group", None):
            await self.channel_layer.group_discard(self.group, self.channel_name)
            if not self.is_presenter and self.nick:
                await self._bump_participants(-1)
                await self._broadcast_participants()

    # ── inbound ──────────────────────────────────────────────────────
    async def receive(self, text_data=None, bytes_data=None):
        try:
            data = json.loads(text_data or "{}")
        except (ValueError, TypeError):
            return

        mtype = data.get("type")

        if mtype == "presenter_hello":
            self.is_presenter = True
            await self._broadcast_participants()

        elif mtype == "controller_hello":
            pin = str(data.get("pin") or "").strip()
            if pin and pin == await self._control_pin():
                self.is_controller = True
                await self.send_json({
                    "type": "controller_ok",
                    "current_slide": await self._current_slide(),
                    # Send the latest slides from the DB so phone notes are fresh,
                    # even if the phone controller page was opened before the
                    # presenter saved/started the slideshow.
                    "slides": await self._slides(),
                })
            else:
                await self.send_json({"type": "controller_denied"})

        elif mtype == "join":
            self.nick = (data.get("nick") or "").strip()[:40] or "Anonymous"
            await self._bump_participants(+1)
            await self._broadcast_participants()

        elif mtype == "react":
            await self._handle_react(data)

        elif mtype == "goto":
            # Presenter screen or PIN-approved phone controller drives slides.
            if self.is_presenter or self.is_controller:
                await self._handle_goto(data)

        elif mtype == "pointer":
            # PIN-approved phone controller can point to an area of the slide.
            if self.is_presenter or self.is_controller:
                await self._handle_pointer(data)

    # ── reactions ────────────────────────────────────────────────────
    async def _handle_react(self, data):
        emoji = data.get("emoji")
        if emoji not in ALLOWED_REACTIONS:
            return
        if not await self._reactions_allowed():
            return
        # Fan the reaction out to every screen on this deck — the presenter
        # stage floats it up; other phones can ignore it.
        await self.channel_layer.group_send(self.group, {
            "type": "fanout",
            "payload": {"type": "reaction", "emoji": emoji},
        })

    async def _handle_goto(self, data):
        try:
            index = int(data.get("index"))
        except (TypeError, ValueError):
            return
        index = max(0, index)
        await self._set_current_slide(index)
        slide = await self._slide(index)
        await self.channel_layer.group_send(self.group, {
            "type": "fanout",
            "payload": {"type": "goto", "index": index, "slide": slide},
        })

    async def _handle_pointer(self, data):
        try:
            x = float(data.get("x"))
            y = float(data.get("y"))
        except (TypeError, ValueError):
            return
        # x/y are in the 960×540 design coordinate space. Clamp so a bad
        # phone tap cannot create off-screen overlays.
        x = max(0, min(960, x))
        y = max(0, min(540, y))
        await self.channel_layer.group_send(self.group, {
            "type": "fanout",
            "payload": {"type": "pointer", "x": x, "y": y},
        })

    # ── group fanout ─────────────────────────────────────────────────
    async def fanout(self, event):
        await self.send_json(event["payload"])

    async def _broadcast_participants(self):
        count = await self._participant_count()
        await self.channel_layer.group_send(self.group, {
            "type": "fanout",
            "payload": {"type": "participants", "count": count},
        })

    # ── helpers ──────────────────────────────────────────────────────
    async def send_json(self, obj):
        await self.send(text_data=json.dumps(obj))

    # In-memory headcount per process. For a single-process dev/ASGI server
    # this is exact; behind multiple workers it counts per-worker, the same
    # caveat Boardly's participant count carries. Promote to a Redis/db
    # counter if you run multiple workers and need a global figure.
    _counts = {}

    async def _bump_participants(self, delta):
        PresentConsumer._counts[self.code] = max(
            0, PresentConsumer._counts.get(self.code, 0) + delta
        )

    async def _participant_count(self):
        return PresentConsumer._counts.get(self.code, 0)

    # ── DB access (wrapped sync) ─────────────────────────────────────
    @sync_to_async
    def _get_deck(self, code):
        from .models import Deck
        return Deck.objects.filter(code=code).first()

    @sync_to_async
    def _reactions_allowed(self):
        from .models import Deck
        d = Deck.objects.filter(code=self.code).first()
        return bool(d and d.allow_reactions and d.state != "ended")

    @sync_to_async
    def _set_current_slide(self, index):
        from .models import Deck
        Deck.objects.filter(code=self.code).update(current_slide=index)

    @sync_to_async
    def _current_slide(self):
        from .models import Deck
        d = Deck.objects.filter(code=self.code).first()
        return int(d.current_slide) if d else 0

    @sync_to_async
    def _slides(self):
        from .models import Deck
        d = Deck.objects.filter(code=self.code).first()
        return [s.as_dict() for s in d.slides.all()] if d else []

    @sync_to_async
    def _slide(self, index):
        from .models import Deck
        d = Deck.objects.filter(code=self.code).first()
        if not d:
            return {}
        slides = list(d.slides.all())
        if not slides:
            return {}
        index = max(0, min(int(index), len(slides) - 1))
        return slides[index].as_dict()

    @sync_to_async
    def _control_pin(self):
        total = sum((i + 1) * ord(ch) for i, ch in enumerate(self.code or "HANNS"))
        return str(1000 + (total % 9000))

    @sync_to_async
    def _snapshot(self):
        from .models import Deck
        d = Deck.objects.filter(code=self.code).first()
        if not d:
            return {"type": "state"}
        return {
            "type": "state",
            "code": d.code,
            "title": d.title,
            "current_slide": d.current_slide,
            "allow_reactions": d.allow_reactions,
            "live": d.state == "live",
            "count": PresentConsumer._counts.get(self.code, 0),
        }
