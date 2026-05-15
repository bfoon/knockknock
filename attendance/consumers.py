"""
WebSocket consumer for the attendance app.

Two kinds of clients connect to the same group `attendance_event_<id>`:

  - The organizer's live dashboard. Reacts to: new_registration, check_in,
    announcement (echoed for their own UI), event_ended.

  - Each attendee's ticket page. Reacts to: announcement, event_ended.

We don't separate them server-side — every client just gets the broadcast
and decides what to render. The payload's `type` field is the discriminator.

Mirrors the SessionConsumer pattern in presentations/consumers.py
(referenced by routing.py in the uploads).
"""

import json

from channels.generic.websocket import AsyncWebsocketConsumer

from .models import AttendanceEvent


class AttendanceConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.event_pk = self.scope["url_route"]["kwargs"]["event_id"]
        self.group_name = f"attendance_event_{self.event_pk}"

        # We allow anyone to listen — the broadcasts don't contain PII beyond
        # display name and counts, and ticket pages need to receive
        # announcements without being logged in. If you need auth, add an
        # `if not user.is_authenticated: await self.close()` here.

        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def broadcast(self, event):
        """Server-pushed message; the layer sends payload as `event["payload"]`."""
        await self.send(text_data=json.dumps(event["payload"]))

    async def receive(self, text_data=None, bytes_data=None):
        # Clients don't drive state — they only listen. Ignore inbound.
        return
