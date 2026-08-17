"""
kura/chat_consumers.py — WebSocket consumer for survey chat.

Same shape as MonitorConsumer: kwargs off the URL route, a per-thread
group, @sync_to_async for every DB touch, and a hard authorisation check
before accept() so a guessed thread id leaks nothing.

Route (kura/routing.py):
    ws/kura/<code>/chat/<thread_id>/

Client → server messages:
    {"type": "message", "body": "...", "context": {...}}
    {"type": "typing"}
    {"type": "read", "id": 42}
    {"type": "ping"}

Server → client messages:
    {"type": "chat_ok", "thread": {...}, "you": 7}
    {"type": "message", "message": {...}}
    {"type": "typing", "user": "aisha"}
    {"type": "pong"}

Posting goes through kura.chat.post(), which persists first and then
fans out — so a client whose socket dropped still gets the message from
the polling endpoint.
"""

import json

from asgiref.sync import sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer

from .chat import thread_group

MAX_BODY = 4000


class ChatConsumer(AsyncWebsocketConsumer):

    async def connect(self):
        kwargs = self.scope["url_route"]["kwargs"]
        self.code = kwargs["code"].upper()
        try:
            self.thread_id = int(kwargs["thread_id"])
        except (TypeError, ValueError):
            await self.close()
            return

        info = await self._authorise()
        if not info:
            await self.close()
            return

        self.thread_info = info
        self.group = thread_group(self.thread_id)
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()
        await self.send_json({
            "type": "chat_ok",
            "thread": info["thread"],
            "you": info["user_id"],
            "username": info["username"],
        })

    async def disconnect(self, code):
        if getattr(self, "group", None):
            await self.channel_layer.group_discard(self.group, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        try:
            data = json.loads(text_data or "{}")
        except (ValueError, TypeError):
            return
        if not isinstance(data, dict):
            return

        kind = data.get("type")

        if kind == "ping":
            await self.send_json({"type": "pong"})
            return

        if kind == "typing":
            await self.channel_layer.group_send(self.group, {
                "type": "chat.event",
                "payload": {"type": "typing",
                            "user": self.thread_info["username"]},
                "skip": self.channel_name,
            })
            return

        if kind == "read":
            await self._mark_read(data.get("id"))
            return

        if kind == "message":
            body = (data.get("body") or "").strip()[:MAX_BODY]
            if not body:
                return
            context = data.get("context")
            await self._post(body, context if isinstance(context, dict) else None)
            return

    # ── group fanout ─────────────────────────────────────────────────

    async def chat_event(self, event):
        # Typing indicators skip their own sender; messages go to everyone
        # (including the sender, so their optimistic bubble reconciles).
        if event.get("skip") == self.channel_name:
            return
        await self.send_json(event["payload"])

    async def send_json(self, obj):
        await self.send(text_data=json.dumps(obj))

    # ── database ─────────────────────────────────────────────────────

    @sync_to_async
    def _authorise(self):
        from .chat import can_access
        from .models import Survey
        from .models_team import ChatThread, TeamConfig

        user = self.scope.get("user")
        if not user or not getattr(user, "is_authenticated", False):
            return None

        survey = Survey.objects.filter(code=self.code).first()
        if survey is None:
            return None
        if not TeamConfig.for_survey(survey).chat_enabled:
            return None

        thread = (ChatThread.objects
                  .filter(id=self.thread_id, survey=survey)
                  .select_related("team", "survey").first())
        if thread is None or not can_access(user, thread):
            return None

        return {
            "thread": thread.as_dict(),
            "user_id": user.id,
            "username": user.get_username(),
        }

    @sync_to_async
    def _post(self, body, context):
        from .chat import post
        from .models_team import ChatThread

        thread = ChatThread.objects.filter(id=self.thread_id).first()
        if thread is None:
            return
        post(thread, self.scope["user"], body, context=context)

    @sync_to_async
    def _mark_read(self, up_to_id):
        from .chat import mark_read
        from .models_team import ChatThread

        thread = ChatThread.objects.filter(id=self.thread_id).first()
        if thread is None:
            return
        try:
            up_to_id = int(up_to_id) if up_to_id is not None else None
        except (TypeError, ValueError):
            up_to_id = None
        mark_read(thread, self.scope["user"], up_to_id)
