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
    {type:"edit", id, text, color, icon,       edit a note's content; the
           group_id}                           presenter may edit any note,
                                               an author only their own.
                                               Omitted fields are unchanged.
                                               The original is preserved in
                                               a NoteEdit history row.
    {type:"move_group", id, group_id}          move a note to another column
                                               (group_id null = no column)
    {type:"add_group", name}                   presenter adds a topic column
    {type:"rename_group", id, name}            presenter renames a column
    {type:"delete_group", id}                  presenter deletes a column —
                                               its notes are deleted too
    {type:"set_column_lock", locked}           presenter locks/unlocks
                                               cross-column note moves
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
    {type:"note_edited", note}  a note's content changed (full note dict)
    {type:"edit_rejected", reason}
    {type:"group_added", group} a new column {id, name}
    {type:"group_renamed", id, name}           a column was renamed
    {type:"group_removed", id, note_ids}       a column (and its notes)
                                               were deleted
    {type:"column_lock_changed", locked}       cross-column moves locked?
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

        elif mtype == "edit":
            # Presenter may edit any note; a participant may edit only
            # their own. _handle_edit enforces ownership.
            await self._handle_edit(data)

        elif mtype == "move_group":
            # Only the presenter may move a note between columns.
            if self.is_presenter:
                await self._handle_move_group(data)

        elif mtype == "add_group":
            # Only the presenter may add a column to a live board.
            if self.is_presenter:
                await self._handle_add_group(data)

        elif mtype == "rename_group":
            # Only the presenter may rename a column.
            if self.is_presenter:
                await self._handle_rename_group(data)

        elif mtype == "delete_group":
            # Only the presenter may delete a column.
            if self.is_presenter:
                await self._handle_delete_group(data)

        elif mtype == "set_column_lock":
            # Only the presenter may lock/unlock cross-column moves.
            if self.is_presenter:
                await self._handle_set_column_lock(data)

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

    # ── edit a note's content (presenter: any note; author: own) ─────
    async def _handle_edit(self, data):
        note_id = data.get("id")

        # Normalise the incoming fields. Any field that's absent (None)
        # is left unchanged; _edit_note treats None as "keep".
        text = data.get("text")
        if text is not None:
            text = str(text).strip()
            if not text:
                await self.send_json({"type": "edit_rejected",
                                      "reason": "Note can't be empty."})
                return
            text = text[:MAX_NOTE_LEN]

        color = data.get("color")
        if color is not None:
            try:
                color = max(0, min(int(color), 5))
            except (TypeError, ValueError):
                color = None

        icon = data.get("icon")
        if icon is not None and icon not in ALLOWED_ICONS:
            icon = "none"

        # group_id may legitimately be null (= no column), so we use a
        # sentinel to tell "not supplied" apart from "set to none".
        has_group = "group_id" in data
        group_id = data.get("group_id")

        # Respect the column lock. If the board is locked and this edit
        # would move the note to a different column, drop the column
        # change but still apply any text/colour/icon edits, and tell the
        # client why the column didn't move.
        column_blocked = False
        if has_group and await self._columns_locked():
            same = await self._note_in_group(note_id, group_id)
            if not same:
                has_group = False
                group_id = None
                column_blocked = True

        if self.is_presenter:
            editor_kind, editor_name = "presenter", "Presenter"
        else:
            editor_kind, editor_name = "author", (self.nick or "Anonymous")

        note, reason = await self._edit_note(
            note_id=note_id, text=text, color=color, icon=icon,
            has_group=has_group, group_id=group_id,
            editor_kind=editor_kind, editor_name=editor_name,
            require_author=None if self.is_presenter else editor_name,
        )
        if note is None:
            await self.send_json({"type": "edit_rejected",
                                  "reason": reason or "Can't edit that note."})
            return

        if column_blocked:
            await self.send_json({
                "type": "edit_rejected",
                "reason": "Columns are locked — the note's other changes "
                          "were saved, but it stayed in its column.",
            })

        # Broadcast the updated note to everyone — full dict so each
        # client can re-render it in place.
        await self.channel_layer.group_send(self.group, {
            "type": "fanout",
            "payload": {"type": "note_edited", "note": note},
        })

    # ── presenter: move a note to a different column ─────────────────
    async def _handle_move_group(self, data):
        note_id = data.get("id")
        group_id = data.get("group_id")  # may be null → ungrouped

        # Enforce the column lock. When the board is locked, a note may
        # not be moved ACROSS columns — only no-op "moves" to its current
        # column are allowed (the client shouldn't send those anyway).
        if await self._columns_locked():
            same = await self._note_in_group(note_id, group_id)
            if not same:
                await self.send_json({
                    "type": "edit_rejected",
                    "reason": "Columns are locked — notes can't be moved "
                              "between columns.",
                })
                return

        note, reason = await self._edit_note(
            note_id=note_id, text=None, color=None, icon=None,
            has_group=True, group_id=group_id,
            editor_kind="presenter", editor_name="Presenter",
            require_author=None,
        )
        if note is None:
            return
        await self.channel_layer.group_send(self.group, {
            "type": "fanout",
            "payload": {"type": "note_edited", "note": note},
        })

    # ── presenter: add a topic column to a live board ────────────────
    async def _handle_add_group(self, data):
        name = (data.get("name") or "").strip()[:60]
        if not name:
            return
        group = await self._create_group(name)
        if group is None:
            return
        await self.channel_layer.group_send(self.group, {
            "type": "fanout",
            "payload": {"type": "group_added", "group": group},
        })

    # ── presenter: rename a column ───────────────────────────────────
    async def _handle_rename_group(self, data):
        group_id = data.get("id")
        name = (data.get("name") or "").strip()[:60]
        if not name:
            return
        ok = await self._rename_group(group_id, name)
        if not ok:
            return
        await self.channel_layer.group_send(self.group, {
            "type": "fanout",
            "payload": {"type": "group_renamed", "id": group_id, "name": name},
        })

    # ── presenter: delete a column (and the notes inside it) ─────────
    async def _handle_delete_group(self, data):
        group_id = data.get("id")
        note_ids = await self._delete_group(group_id)
        if note_ids is None:
            return
        # Broadcast the column removal along with the ids of the notes
        # that went with it, so every screen can drop them too.
        await self.channel_layer.group_send(self.group, {
            "type": "fanout",
            "payload": {
                "type": "group_removed",
                "id": group_id,
                "note_ids": note_ids,
            },
        })

    # ── presenter: lock / unlock cross-column note moves ─────────────
    async def _handle_set_column_lock(self, data):
        locked = bool(data.get("locked"))
        ok = await self._set_column_lock(locked)
        if not ok:
            return
        await self.channel_layer.group_send(self.group, {
            "type": "fanout",
            "payload": {"type": "column_lock_changed", "locked": locked},
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
    def _columns_locked(self):
        """True when cross-column note moves are disallowed."""
        from .models import BoardSession
        s = BoardSession.objects.filter(code=self.code).first()
        return bool(s and s.lock_columns)

    @sync_to_async
    def _set_column_lock(self, locked):
        from .models import BoardSession
        s = BoardSession.objects.filter(code=self.code).first()
        if not s:
            return False
        s.lock_columns = bool(locked)
        s.save(update_fields=["lock_columns", "updated_at"])
        return True

    @sync_to_async
    def _note_in_group(self, note_id, group_id):
        """
        True if the note already belongs to ``group_id`` — i.e. a "move"
        to that group would be a no-op. Used to tell a real cross-column
        move apart from a same-column drop when the board is locked.
        ``group_id`` None means "no column".
        """
        from .models import Note
        note = Note.objects.filter(
            id=note_id, session__code=self.code,
        ).first()
        if not note:
            # Unknown note — treat as "not a no-op" so it gets rejected
            # by the normal path rather than silently passing the lock.
            return False
        current = note.group_id
        target = None if group_id is None else group_id
        try:
            if target is not None:
                target = int(target)
        except (TypeError, ValueError):
            return False
        return current == target

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
            "lock_columns": s.lock_columns,
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
    def _edit_note(self, note_id, text, color, icon, has_group, group_id,
                   editor_kind, editor_name, require_author):
        """
        Apply an edit to a note and record a NoteEdit history row.

        Any of text/color/icon may be None meaning "leave unchanged".
        ``has_group`` False means the column isn't being touched; True
        means set it to ``group_id`` (which itself may be None = no
        column). ``require_author`` (a nickname) restricts the edit to
        that author's own notes; None lets the presenter edit anything.

        Returns (note_dict, None) on success or (None, reason) on
        failure. The original field values are preserved in the
        NoteEdit row, so nothing recorded is lost.
        """
        from .models import Note, NoteEdit

        note = Note.objects.filter(
            id=note_id, session__code=self.code,
        ).select_related("session").first()
        if not note:
            return None, "That note no longer exists."

        if require_author is not None and note.author != require_author:
            return None, "You can only edit your own notes."

        # Resolve the target group, if the column is being changed.
        new_group = note.group
        new_group_id = note.group_id
        if has_group:
            if group_id is None:
                new_group, new_group_id = None, None
            else:
                g = note.session.groups.filter(id=group_id).first()
                if g is None:
                    return None, "That column doesn't exist."
                new_group, new_group_id = g, g.id

        # Snapshot the "before" values.
        old = {
            "text": note.text, "color": note.color, "icon": note.icon,
            "group_id": note.group_id,
        }
        new = {
            "text": note.text if text is None else text,
            "color": note.color if color is None else color,
            "icon": note.icon if icon is None else icon,
            "group_id": new_group_id,
        }

        # Nothing actually changed → no-op, no history row.
        if new == old:
            return note.as_dict(), None

        note.text = new["text"]
        note.color = new["color"]
        note.icon = new["icon"]
        note.group = new_group
        note.edited_at = timezone.now()
        note.save(update_fields=[
            "text", "color", "icon", "group", "edited_at",
        ])

        NoteEdit.objects.create(
            note=note,
            edited_by=editor_kind,
            editor_name=editor_name[:40],
            old_text=old["text"], new_text=new["text"],
            old_color=old["color"], new_color=new["color"],
            old_icon=old["icon"], new_icon=new["icon"],
            old_group_id=old["group_id"], new_group_id=new["group_id"],
        )
        return note.as_dict(), None

    @sync_to_async
    def _create_group(self, name):
        """Add a topic column to this board, appended after existing ones."""
        from .models import BoardGroup, BoardSession
        s = BoardSession.objects.filter(code=self.code).first()
        if not s:
            return None
        last = s.groups.order_by("-position").first()
        position = (last.position + 1) if last else 0
        g = BoardGroup.objects.create(
            session=s, name=name, position=position,
        )
        return {"id": g.id, "name": g.name}

    @sync_to_async
    def _rename_group(self, group_id, name):
        """Rename a column on this board. Returns True on success."""
        from .models import BoardGroup
        g = BoardGroup.objects.filter(
            id=group_id, session__code=self.code,
        ).first()
        if not g:
            return False
        g.name = name
        g.save(update_fields=["name"])
        return True

    @sync_to_async
    def _delete_group(self, group_id):
        """
        Delete a column AND the notes inside it.

        Returns the list of deleted note ids (possibly empty) so the
        broadcast can tell every screen which notes to drop, or None if
        the column doesn't belong to this board.
        """
        from .models import BoardGroup
        g = BoardGroup.objects.filter(
            id=group_id, session__code=self.code,
        ).first()
        if not g:
            return None
        # Collect the note ids before deleting so clients can prune them.
        note_ids = list(g.notes.values_list("id", flat=True))
        # Notes inside the column go with it. The BoardGroup→Note FK is
        # SET_NULL, so deleting the group alone would orphan the notes;
        # we delete them explicitly first to honour "delete notes too".
        g.notes.all().delete()
        g.delete()
        return note_ids

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
