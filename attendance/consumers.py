"""
WebSocket consumer for the attendance app.

TWO GROUPS, NOT ONE
-------------------
Every client used to join a single group, `attendance_event_<id>`, and receive
every broadcast. The docstring acknowledged this and said public ticket pages
"decide what to render" — but a client choosing not to render something does
not stop the server sending it. `broadcast_new_registration` and
`broadcast_check_in` both carry `registration.display_name()`.

`connect()` accepts anyone, with no authentication, and the event id in the
URL is a sequential integer. So anybody could open

    ws://host/ws/attendance/41/

and watch a live feed of every person registering for event 41 and every
person checking in, by name, with timestamps — for any event on the platform,
found by counting upwards.

Now there are two groups:

    attendance_event_<id>          public  — announcements, event_ended
    attendance_event_<id>_staff    staff   — everything, plus names and counts

A socket joins the staff group only after we confirm the connected user owns
the event. Public clients are never sent attendee data, so a client-side
mistake cannot expose it.

Senders pick a group by calling the helpers in services.py: use
`broadcast_to_event` for anything an attendee may see, and
`broadcast_to_event_staff` for anything containing personal data.
"""

import json

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer

from .models import AttendanceEvent


def public_group(event_pk):
    return f"attendance_event_{event_pk}"


def staff_group(event_pk):
    return f"attendance_event_{event_pk}_staff"


class AttendanceConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.event_pk = self.scope["url_route"]["kwargs"]["event_id"]
        self.public_group_name = public_group(self.event_pk)
        self.staff_group_name = staff_group(self.event_pk)
        self.is_staff_socket = False

        # Anyone may listen to the public group: ticket pages need
        # announcements without being logged in, and nothing on that channel
        # identifies an attendee.
        await self.channel_layer.group_add(self.public_group_name, self.channel_name)

        if await self._user_owns_event():
            self.is_staff_socket = True
            await self.channel_layer.group_add(self.staff_group_name, self.channel_name)

        await self.accept()

    async def disconnect(self, code):
        await self.channel_layer.group_discard(self.public_group_name, self.channel_name)
        if getattr(self, "is_staff_socket", False):
            await self.channel_layer.group_discard(self.staff_group_name, self.channel_name)

    @database_sync_to_async
    def _user_owns_event(self):
        user = self.scope.get("user")
        if user is None or not user.is_authenticated:
            return False
        return AttendanceEvent.objects.filter(
            pk=self.event_pk, owner=user,
        ).exists()

    async def broadcast(self, event):
        """Server-pushed message; the layer sends payload as `event["payload"]`."""
        await self.send(text_data=json.dumps(event["payload"]))

    async def receive(self, text_data=None, bytes_data=None):
        # Clients don't drive state — they only listen. Ignore inbound.
        return
