"""
hanns/screen_consumers.py — the Big Screen's own WebSocket.

    ws://<host>/ws/hanns/screen/<token>/

Read-only on purpose. The screen and the host dashboard only LISTEN here;
every action (put a deck on air, issue a control code, stop the screen)
goes over plain HTTP with CSRF, and the view pushes the fresh snapshot into
this group afterwards. That keeps one authoritative write path and makes
the socket safe to reconnect at any time — a reconnect just receives the
current snapshot again.

The deck that is on air still runs on its OWN socket (ws/hanns/<CODE>/)
inside the embedded stage, exactly as it does on /present/, so the phone
controller, reveals, zoom regions and reactions all work unchanged.

Server → client:
    {type:"screen_state", state:{…}, notice?:{kind, share, title, sharer}}
    {type:"screen_stopped", name}
    {type:"ping"} / {type:"pong"}
"""

import asyncio
import json

from asgiref.sync import sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer

HEARTBEAT_SECONDS = 20


class ScreenConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.token = self.scope["url_route"]["kwargs"]["token"]
        info = await self._load()
        if info is None:
            await self.close()
            return
        self.group, snapshot = info
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()
        self._hb = asyncio.create_task(self._heartbeat())
        await self._send({"type": "screen_state", "state": snapshot})

    async def disconnect(self, code):
        hb = getattr(self, "_hb", None)
        if hb:
            hb.cancel()
        if getattr(self, "group", None):
            await self.channel_layer.group_discard(self.group, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        try:
            data = json.loads(text_data or "{}")
        except (ValueError, TypeError):
            return
        t = data.get("type")
        if t == "ping":
            await self._send({"type": "pong"})
        elif t == "sync":
            info = await self._load()
            if info:
                await self._send({"type": "screen_state", "state": info[1]})

    async def screen_event(self, event):
        await self._send(event["payload"])

    async def _heartbeat(self):
        try:
            while True:
                await asyncio.sleep(HEARTBEAT_SECONDS)
                await self._send({"type": "ping"})
        except asyncio.CancelledError:
            raise
        except Exception:
            return

    async def _send(self, obj):
        await self.send(text_data=json.dumps(obj))

    @sync_to_async
    def _load(self):
        from .models import BigScreen
        from .screen import screen_group, screen_state
        screen = BigScreen.objects.filter(token=self.token).first()
        if not screen:
            return None
        return screen_group(screen.id), screen_state(screen)
