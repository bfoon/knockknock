"""
kura/consumers.py — WebSocket consumer for the Kura live monitor.

Mirrors hanns.PresentConsumer's shape: code from the URL kwarg, a per-survey
group, fanout + send_json helpers, @sync_to_async DB access. It is
receive-only from the browser's point of view — the HTTP layer (web submit
view + mobile sync API) does the broadcasting via kura.live.broadcast(),
so the socket only carries "a submission just arrived" / "a device just
synced" events to whoever is watching the monitor page.

Only the survey owner may connect (checked against the authenticated
scope user), so response metadata never leaks over a guessable code.
"""

import json

from asgiref.sync import sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer

from .live import monitor_group


class MonitorConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.code = self.scope["url_route"]["kwargs"]["code"].upper()
        self.group = monitor_group(self.code)

        if not await self._can_monitor():
            await self.close()
            return

        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()
        await self.send_json({"type": "monitor_ok", "code": self.code})

    async def disconnect(self, code):
        if getattr(self, "group", None):
            await self.channel_layer.group_discard(self.group, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        # Browser → server traffic is only a keep-alive ping.
        try:
            data = json.loads(text_data or "{}")
        except (ValueError, TypeError):
            return
        if data.get("type") == "ping":
            await self.send_json({"type": "pong"})

    # ── group fanout ─────────────────────────────────────────────────
    async def fanout(self, event):
        await self.send_json(event["payload"])

    async def send_json(self, obj):
        await self.send(text_data=json.dumps(obj))

    # ── auth ─────────────────────────────────────────────────────────
    @sync_to_async
    def _can_monitor(self):
        from .models import Survey
        user = self.scope.get("user")
        if not user or not getattr(user, "is_authenticated", False):
            return False
        return Survey.objects.filter(code=self.code, owner=user).exists()
