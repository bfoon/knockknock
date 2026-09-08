"""
kura/dashboard_consumers.py — the socket that makes a board live.

Design note: this consumer pushes a *nudge*, not data.

When a submission lands, every open board gets ``{"type":"data_changed"}``
and re-fetches over HTTP. That looks like an extra round trip, and it is —
but it means the fanout payload is 30 bytes regardless of how many tiles a
board has, the aggregation happens once behind the frame cache instead of
once per socket, and a viewer whose socket dropped for ninety seconds
recovers with exactly the same code path as a viewer who never connected.
Pushing computed tiles down the socket would invert all three properties.

Auth mirrors MonitorConsumer: the survey owner and collaborators always;
an anonymous viewer only on a board the owner has explicitly published,
and then only via its share token.
"""

import json

from asgiref.sync import sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer

from .live import dashboard_group


class DashboardConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        kwargs = self.scope["url_route"]["kwargs"]
        self.token = kwargs.get("token")
        self.code = (kwargs.get("code") or "").upper()

        resolved = await self._authorize()
        if not resolved:
            await self.close()
            return

        self.code = resolved
        self.group = dashboard_group(self.code)
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()
        await self.send_json({"type": "dashboard_ok", "code": self.code})

    async def disconnect(self, code):
        if getattr(self, "group", None):
            await self.channel_layer.group_discard(self.group, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        try:
            data = json.loads(text_data or "{}")
        except (ValueError, TypeError):
            return
        if data.get("type") == "ping":
            await self.send_json({"type": "pong"})

    async def fanout(self, event):
        await self.send_json(event["payload"])

    async def send_json(self, obj):
        await self.send(text_data=json.dumps(obj))

    @sync_to_async
    def _authorize(self):
        """Return the survey code this socket may watch, or None."""
        from .models import Survey
        from .models_dashboard import LiveDashboard

        if self.token:
            board = LiveDashboard.objects.filter(
                public_token=self.token, is_public=True,
            ).select_related("survey").first()
            return board.survey.code if board else None

        user = self.scope.get("user")
        if not user or not getattr(user, "is_authenticated", False):
            return None
        survey = Survey.objects.filter(code=self.code).first()
        if survey is None:
            return None
        if survey.owner_id == user.id:
            return survey.code
        if survey.collaborators.filter(user=user).exists():
            return survey.code
        return None
