"""
boardly/consumers.py — WebSocket consumer for the Boardly sticky board.

Plug into your existing ASGI routing alongside the poll consumer:

    # routing.py
    from boardly.consumers import BoardConsumer
    websocket_urlpatterns += [
        re_path(r"ws/board/(?P<code>\\w+)/$", BoardConsumer.as_asgi()),
    ]

Speaks JSON. Client → server messages:
    {type:"join", nick}                        participant joined
    {type:"presenter_hello"}                   presenter screen connected
    {type:"note", text, color, icon, group_id} participant posts a note
    {type:"like", id}                          someone liked a note
    {type:"mod", action, id}                   presenter moderation
                                               action ∈ hide|show|delete|pin|unpin
    {type:"move", id, x, y}                    presenter dragged a note
                                               x,y are 0.0–1.0 fractions
    {type:"burn", id}                          presenter burns a note —
                                               animate everywhere, then delete
    {type:"set_state", state}                  presenter opens/closes the board
                                               state ∈ open|ended
    {type:"set_limit", limit}                  presenter changes the
                                               per-participant note cap (0 = off)

Server → client messages:
    {type:"state", ...}        full snapshot (sent on connect)
    {type:"board_state", state} live state change (lobby/open/ended)
    {type:"note_added", note}  a new note for the board
    {type:"note_ack", ...}     confirmation back to the author
    {type:"note_rejected", reason}
    {type:"note_likes", id, likes}
    {type:"note_moderated", action, id}
    {type:"note_moved", id, x, y}              broadcast new position
    {type:"note_burned", id}                   play burn FX, then drop note
    {type:"note_removed"/"note_restored", id}  targeted at the author
    {type:"limit_changed", limit}              new per-participant cap
    {type:"participants", count}
    {type:"board_ended"}
"""

import json

from asgiref.sync import sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer
from django.utils import timezone


MAX_NOTE_LEN = 180
ALLOWED_ICONS = {
    "lightbulb", "star", "heart", "chat", "people",
    "target", "rocket", "check", "none",
}


class BoardConsumer(AsyncWebsocketConsumer):
    # ── lifecycle ────────────────────────────────────────────────────
    async def connect(self):
        self.code = self.scope["url_route"]["kwargs"]["code"].upper()
        self.group = f"board_{self.code}"
        self.nick = None
        self.is_presenter = False

        self.session = await self._get_session(self.code)
        if self.session is None:
            await self.close()
            return

        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()

        # Send a full snapshot so a (re)connecting client can rebuild.
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

        elif mtype == "join":
            self.nick = (data.get("nick") or "").strip()[:40] or "Anonymous"
            await self._bump_participants(+1)
            await self._broadcast_participants()

        elif mtype == "note":
            await self._handle_note(data)

        elif mtype == "like":
            await self._handle_like(data)

        elif mtype == "mod":
            # Only the presenter screen may moderate.
            if self.is_presenter:
                await self._handle_mod(data)

        elif mtype == "move":
            # Only the presenter may rearrange the board.
            if self.is_presenter:
                await self._handle_move(data)

        elif mtype == "burn":
            # Only the presenter may burn (animated delete) a note.
            if self.is_presenter:
                await self._handle_burn(data)

        elif mtype == "set_state":
            # Only the presenter screen may open/close the board.
            if self.is_presenter:
                await self._handle_set_state(data)

        elif mtype == "set_limit":
            # Only the presenter may change the per-participant cap.
            if self.is_presenter:
                await self._handle_set_limit(data)

    # ── note posting ─────────────────────────────────────────────────
    async def _handle_note(self, data):
        text = (data.get("text") or "").strip()
        if not text:
            await self.send_json({"type": "note_rejected",
                                  "reason": "Note is empty."})
            return
        if len(text) > MAX_NOTE_LEN:
            text = text[:MAX_NOTE_LEN]

        if not await self._board_open():
            await self.send_json({"type": "note_rejected",
                                  "reason": "The board isn't open."})
            return

        # Per-participant cap. 0 means unlimited. Notes are counted by
        # author nickname within this session — consistent with how the
        # rest of the consumer identifies participants. Note this is a
        # soft limit: it can't tell two participants with the same
        # nickname apart, and a participant who rejoins under a new name
        # gets a fresh count.
        limit = await self._note_limit()
        if limit:
            already = await self._author_note_count(self.nick or "Anonymous")
            if already >= limit:
                await self.send_json({
                    "type": "note_rejected",
                    "reason": f"You've reached the {limit}-note limit "
                              f"for this board.",
                })
                return

        try:
            color = int(data.get("color", 0))
        except (TypeError, ValueError):
            color = 0
        color = max(0, min(color, 5))

        icon = data.get("icon") or "none"
        if icon not in ALLOWED_ICONS:
            icon = "none"

        group_id = data.get("group_id")

        note = await self._create_note(
            text=text, color=color, icon=icon,
            group_id=group_id, author=self.nick or "Anonymous",
        )

        # Confirm to the author (so their "my notes" list gets the real id).
        await self.send_json({
            "type": "note_ack",
            "id": note["id"], "text": note["text"], "color": note["color"],
        })

        # Broadcast the new note to the whole board (presenter + everyone).
        await self.channel_layer.group_send(self.group, {
            "type": "fanout",
            "payload": {"type": "note_added", "note": note},
        })

    # ── likes ────────────────────────────────────────────────────────
    async def _handle_like(self, data):
        note_id = data.get("id")
        likes = await self._add_like(note_id)
        if likes is None:
            return
        await self.channel_layer.group_send(self.group, {
            "type": "fanout",
            "payload": {"type": "note_likes", "id": note_id, "likes": likes},
        })

    # ── moderation ───────────────────────────────────────────────────
    async def _handle_mod(self, data):
        action = data.get("action")
        note_id = data.get("id")
        if action not in {"hide", "show", "delete", "pin", "unpin"}:
            return

        ok, author_channel = await self._apply_mod(action, note_id)
        if not ok:
            return

        await self.channel_layer.group_send(self.group, {
            "type": "fanout",
            "payload": {"type": "note_moderated", "action": action, "id": note_id},
        })

        # Let the note's author know if their note was hidden/removed.
        if action in {"hide", "delete"}:
            await self.channel_layer.group_send(self.group, {
                "type": "fanout",
                "payload": {"type": "note_removed", "id": note_id},
            })
        elif action == "show":
            await self.channel_layer.group_send(self.group, {
                "type": "fanout",
                "payload": {"type": "note_restored", "id": note_id},
            })

    # ── presenter: drag a note to a new position ─────────────────────
    async def _handle_move(self, data):
        note_id = data.get("id")
        try:
            x = float(data.get("x"))
            y = float(data.get("y"))
        except (TypeError, ValueError):
            return
        # Clamp to the board so a note can't be dragged off-sheet.
        x = max(0.0, min(x, 1.0))
        y = max(0.0, min(y, 1.0))

        ok = await self._set_note_pos(note_id, x, y)
        if not ok:
            return
        await self.channel_layer.group_send(self.group, {
            "type": "fanout",
            "payload": {"type": "note_moved", "id": note_id, "x": x, "y": y},
        })

    # ── presenter: burn a note (animated delete) ─────────────────────
    async def _handle_burn(self, data):
        note_id = data.get("id")
        # Broadcast the burn first so every screen plays the animation
        # while the row still exists, THEN remove it from the DB.
        ok = await self._note_exists(note_id)
        if not ok:
            return
        await self.channel_layer.group_send(self.group, {
            "type": "fanout",
            "payload": {"type": "note_burned", "id": note_id},
        })
        await self._delete_note(note_id)
        # Also tell the author their note is gone (mirrors moderation).
        await self.channel_layer.group_send(self.group, {
            "type": "fanout",
            "payload": {"type": "note_removed", "id": note_id},
        })

    # ── presenter: change the per-participant note cap ───────────────
    async def _handle_set_limit(self, data):
        try:
            limit = int(data.get("limit", 0))
        except (TypeError, ValueError):
            return
        limit = max(0, min(limit, 999))  # 0 = unlimited
        ok = await self._set_limit(limit)
        if not ok:
            return
        await self.channel_layer.group_send(self.group, {
            "type": "fanout",
            "payload": {"type": "limit_changed", "limit": limit},
        })


    async def _handle_set_state(self, data):
        new_state = data.get("state")
        if new_state not in {"open", "ended"}:
            return
        ok = await self._set_state(new_state)
        if not ok:
            return
        # Tell the whole board (presenter + every participant) so the
        # participant pads move waiting → compose → ended live.
        await self.channel_layer.group_send(self.group, {
            "type": "fanout",
            "payload": {"type": "board_state", "state": new_state},
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

    # ── DB access (wrapped sync) ─────────────────────────────────────
    # These call into models.py. Kept thin so the protocol above is the
    # contract; swap the ORM details to match your project as needed.

    @sync_to_async
    def _get_session(self, code):
        from .models import BoardSession
        return BoardSession.objects.filter(code=code).first()

    @sync_to_async
    def _board_open(self):
        from .models import BoardSession
        s = BoardSession.objects.filter(code=self.code).first()
        return bool(s and s.state in ("open", "running"))

    @sync_to_async
    def _set_state(self, new_state):
        from .models import BoardSession
        s = BoardSession.objects.filter(code=self.code).first()
        if not s:
            return False
        s.state = new_state
        s.save(update_fields=["state", "updated_at"])
        return True

    @sync_to_async
    def _note_limit(self):
        """Current per-participant cap. 0 = unlimited."""
        from .models import BoardSession
        s = BoardSession.objects.filter(code=self.code).first()
        return s.per_participant_limit if s else 0

    @sync_to_async
    def _author_note_count(self, author):
        """How many notes this author has already posted to the board."""
        from .models import Note
        return Note.objects.filter(
            session__code=self.code, author=author,
        ).count()

    @sync_to_async
    def _set_limit(self, limit):
        from .models import BoardSession
        s = BoardSession.objects.filter(code=self.code).first()
        if not s:
            return False
        s.per_participant_limit = limit
        s.save(update_fields=["per_participant_limit", "updated_at"])
        return True

    @sync_to_async
    def _set_note_pos(self, note_id, x, y):
        from .models import Note
        note = Note.objects.filter(id=note_id, session__code=self.code).first()
        if not note:
            return False
        note.pos_x = x
        note.pos_y = y
        note.save(update_fields=["pos_x", "pos_y"])
        return True

    @sync_to_async
    def _note_exists(self, note_id):
        from .models import Note
        return Note.objects.filter(
            id=note_id, session__code=self.code,
        ).exists()

    @sync_to_async
    def _delete_note(self, note_id):
        from .models import Note
        Note.objects.filter(id=note_id, session__code=self.code).delete()
        return True


    @sync_to_async
    def _snapshot(self):
        from .models import BoardSession
        s = BoardSession.objects.filter(code=self.code).first()
        if not s:
            return {"type": "state", "state": "closed", "notes": []}
        notes = [n.as_dict() for n in s.notes.all().order_by("created_at")]
        groups = [{"id": g.id, "name": g.name}
                  for g in s.groups.all().order_by("position")]
        return {
            "type": "state",
            "state": s.state,
            "prompt": s.prompt,
            "groups": groups,
            "notes": notes,
            "participants": s.participant_count,
            "limit": s.per_participant_limit,
        }

    @sync_to_async
    def _create_note(self, text, color, icon, group_id, author):
        from .models import BoardSession, Note
        s = BoardSession.objects.get(code=self.code)
        group = None
        if group_id is not None:
            group = s.groups.filter(id=group_id).first()
        note = Note.objects.create(
            session=s, text=text, color=color, icon=icon,
            author=author, group=group, created_at=timezone.now(),
        )
        return note.as_dict()

    @sync_to_async
    def _add_like(self, note_id):
        from .models import Note
        note = Note.objects.filter(id=note_id, session__code=self.code).first()
        if not note:
            return None
        note.likes = (note.likes or 0) + 1
        note.save(update_fields=["likes"])
        return note.likes

    @sync_to_async
    def _apply_mod(self, action, note_id):
        from .models import Note
        note = Note.objects.filter(id=note_id, session__code=self.code).first()
        if not note:
            return False, None
        if action == "delete":
            note.delete()
        else:
            if action == "hide":
                note.hidden = True
            elif action == "show":
                note.hidden = False
            elif action == "pin":
                note.pinned = True
            elif action == "unpin":
                note.pinned = False
            note.save()
        return True, None

    @sync_to_async
    def _bump_participants(self, delta):
        from django.db.models import F
        from .models import BoardSession
        BoardSession.objects.filter(code=self.code).update(
            participant_count=F("participant_count") + delta
        )

    @sync_to_async
    def _participant_count(self):
        from .models import BoardSession
        s = BoardSession.objects.filter(code=self.code).first()
        return max(0, s.participant_count) if s else 0
