"""
kura/geostudio/consumers.py — live Geo Studio socket.

    ws/kura/geo/<project_id>/

Owner-only. Carries feature edits (so two tabs / a projector stay in sync),
tracker positions, geofence enter/exit events and finished analyses. The
HTTP views do the broadcasting; the browser only sends pings.
"""

import json

from asgiref.sync import sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer


class GeoStudioConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.pid = str(self.scope["url_route"]["kwargs"]["pid"])
        self.group = f"kura_geo_{self.pid}"
        if not await self._allowed():
            await self.close()
            return
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()
        await self.send(text_data=json.dumps({"type": "hello"}))

    async def disconnect(self, code):
        if getattr(self, "group", None):
            await self.channel_layer.group_discard(self.group, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        try:
            data = json.loads(text_data or "{}")
        except (TypeError, ValueError):
            return
        if data.get("type") == "ping":
            await self.send(text_data=json.dumps({"type": "pong"}))

    async def fanout(self, event):
        await self.send(text_data=json.dumps(event["payload"]))

    @sync_to_async
    def _allowed(self):
        from .models import GeoProject
        user = self.scope.get("user")
        p = GeoProject.objects.filter(pk=self.pid).first()
        return bool(p and p.can_edit(user))
