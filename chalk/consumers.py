"""Chalk realtime board.

Wire protocol — every frame is {"t": "<type>", ...}.

  phone  -> server        server -> everyone
  ---------------------   ------------------------------------------------
  hello                   ready | denied
  stroke_start            stroke_start   (id, tool, color, w, pts)
  stroke_pts              stroke_pts     (id, pts)   -- appended, not replaced
  stroke_end              stroke_end     (id, pts)   -- full point list, committed
  erase {ids}             erase {ids}
  undo | redo | clear     snapshot
  surface {surface}       surface {surface}
  page {index}            snapshot
  page_add | page_delete  snapshot
  pointer {x,y,on}        pointer        (laser, never stored)
  ping                    pong

Only `stroke_end` and the structural messages touch the database, so a normal
lesson costs roughly one write per pen stroke. Everything mid-stroke is pure
fanout through Redis.
"""

import re
import time

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.db import transaction

MAX_POINTS = 12000          # per stroke, after which we stop appending
MAX_STROKES_PER_PAGE = 8000
MAX_UNDO = 60
MAX_PAGES = 60

TOOLS = {"pen", "marker", "chalk", "highlighter"}
SURFACE_KEYS = {"black", "green", "white", "grid", "ruled"}
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{3,8}$")
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")

# Messages the sender already rendered locally — don't echo them back.
# "peer" is here so a socket is never told about its own arrival.
NO_ECHO = {"stroke_start", "stroke_pts", "stroke_end", "pointer", "peer"}


def _num(v, lo=0.0, hi=1.0, default=0.0):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    if f != f:  # NaN
        return default
    return round(min(hi, max(lo, f)), 4)


def clean_points(raw, limit=MAX_POINTS):
    if not isinstance(raw, (list, tuple)):
        return []
    out = []
    for v in raw[:limit]:
        out.append(_num(v))
    if len(out) % 2:
        out.pop()
    return out


def clean_stroke(raw):
    if not isinstance(raw, dict):
        return None
    sid = str(raw.get("id") or "")
    if not ID_RE.match(sid):
        return None
    pts = clean_points(raw.get("pts"))
    if len(pts) < 2:
        return None
    tool = raw.get("tool")
    color = str(raw.get("color") or "")
    return {
        "id": sid,
        "tool": tool if tool in TOOLS else "pen",
        "color": color if COLOR_RE.match(color) else "#ffffff",
        "w": _num(raw.get("w"), 0.0004, 0.12, 0.0035),
        "pts": pts,
    }


class ChalkConsumer(AsyncJsonWebsocketConsumer):
    # ------------------------------------------------------------------
    # lifecycle
    # ------------------------------------------------------------------

    async def connect(self):
        self.code = self.scope["url_route"]["kwargs"]["code"]
        self.group = f"chalk_{self.code}"
        self.role = "guest"
        self.can_draw = False
        self.last_pointer = 0.0
        info = await self._session_info(self.code)
        if not info:
            await self.close(code=4404)
            return
        self.board_id = info["board_id"]
        self.owner_id = info["owner_id"]
        self.token = info["token"]
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if getattr(self, "group", None):
            if self.role in ("stage", "control"):
                await self._fan({"t": "peer", "role": self.role, "state": "left"})
            await self.channel_layer.group_discard(self.group, self.channel_name)

    # ------------------------------------------------------------------
    # inbound
    # ------------------------------------------------------------------

    async def receive_json(self, content, **kwargs):
        if not isinstance(content, dict):
            return
        t = content.get("t")

        if t == "hello":
            return await self._hello(content)
        if t == "ping":
            return await self.send_json({"t": "pong"})
        if not self.can_draw:
            return

        if t == "stroke_start":
            stroke = clean_stroke(content.get("stroke"))
            if stroke:
                await self._fan({"t": "stroke_start", "stroke": stroke})
        elif t == "stroke_pts":
            sid = str(content.get("id") or "")
            pts = clean_points(content.get("pts"), 4000)
            if ID_RE.match(sid) and pts:
                await self._fan({"t": "stroke_pts", "id": sid, "pts": pts})
        elif t == "stroke_end":
            stroke = clean_stroke(content.get("stroke"))
            if stroke:
                await self._fan({"t": "stroke_end", "stroke": stroke})
                await self._commit_stroke(stroke)
        elif t == "erase":
            ids = [str(i) for i in (content.get("ids") or []) if ID_RE.match(str(i))][:400]
            if ids:
                removed = await self._erase(ids)
                if removed:
                    await self._fan({"t": "erase", "ids": ids})
        elif t in ("undo", "redo", "clear"):
            await self._history(t)
            await self._broadcast_snapshot()
        elif t == "surface":
            surface = content.get("surface")
            if surface in SURFACE_KEYS:
                await self._set_surface(surface)
                await self._fan({"t": "surface", "surface": surface})
        elif t == "page":
            idx = content.get("index")
            if isinstance(idx, int) and 0 <= idx < MAX_PAGES:
                if await self._goto_page(idx):
                    await self._broadcast_snapshot()
        elif t == "page_add":
            if await self._add_page():
                await self._broadcast_snapshot()
        elif t == "page_delete":
            if await self._delete_page():
                await self._broadcast_snapshot()
        elif t == "pointer":
            now = time.monotonic()
            if now - self.last_pointer < 0.02:
                return
            self.last_pointer = now
            await self._fan(
                {
                    "t": "pointer",
                    "x": _num(content.get("x")),
                    "y": _num(content.get("y")),
                    "on": bool(content.get("on")),
                }
            )

    async def _hello(self, content):
        role = content.get("role")
        token = str(content.get("token") or "")
        user = self.scope.get("user")
        is_owner = bool(user and user.is_authenticated and user.id == self.owner_id)

        if role == "stage":
            if not is_owner:
                return await self._deny("Only the person who owns this board can project it.")
            self.role = "stage"
            self.can_draw = True
        elif role == "control":
            if token != self.token and not is_owner:
                return await self._deny("That pairing code has been regenerated. Scan the new one.")
            self.role = "control"
            self.can_draw = True
        else:
            return await self._deny("Unknown role.")

        state = await self._snapshot()
        await self.send_json({"t": "ready", "role": self.role, **state})
        await self._fan({"t": "peer", "role": self.role, "state": "joined"})

    async def _deny(self, reason):
        await self.send_json({"t": "denied", "reason": reason})
        await self.close(code=4403)

    # ------------------------------------------------------------------
    # fanout
    # ------------------------------------------------------------------

    async def _fan(self, payload):
        await self.channel_layer.group_send(
            self.group, {"type": "fan.out", "payload": payload, "origin": self.channel_name}
        )

    async def fan_out(self, event):
        payload = event["payload"]
        if event.get("origin") == self.channel_name and payload.get("t") in NO_ECHO:
            return
        await self.send_json(payload)

    async def _broadcast_snapshot(self):
        state = await self._snapshot()
        await self.channel_layer.group_send(
            self.group, {"type": "fan.out", "payload": {"t": "snapshot", **state}, "origin": ""}
        )

    # ------------------------------------------------------------------
    # database
    # ------------------------------------------------------------------

    @database_sync_to_async
    def _session_info(self, code):
        from .models import BoardSession

        s = BoardSession.objects.select_related("board").filter(code=code).first()
        if not s:
            return None
        return {
            "board_id": s.board_id,
            "owner_id": s.board.owner_id,
            "token": s.token,
        }

    @database_sync_to_async
    def _snapshot(self):
        from .models import Board, BoardPage, BoardSession

        board = Board.objects.get(pk=self.board_id)
        session = BoardSession.objects.get(board=board)
        page, _ = BoardPage.objects.get_or_create(board=board, index=session.page_index)
        count = BoardPage.objects.filter(board=board).count() or 1
        return {
            "title": board.title,
            "surface": board.surface,
            "pageIndex": page.index,
            "pageCount": count,
            "strokes": page.strokes,
            "canUndo": bool(page.history),
            "canRedo": bool(page.undone),
        }

    def _page_locked(self):
        from .models import BoardPage, BoardSession

        session = BoardSession.objects.select_for_update().get(board_id=self.board_id)
        page, _ = BoardPage.objects.select_for_update().get_or_create(
            board_id=self.board_id, index=session.page_index
        )
        return session, page

    # -- history -------------------------------------------------------
    #
    # One undo stack and one redo stack, both holding the same entry shape:
    #     {"op": "add" | "del", "items": [{"i": <index>, "s": <stroke>}]}
    # "add" means those strokes were put on the board; "del" means they were
    # taken off. Undo applies the opposite, redo applies it again. Storing the
    # index lets an undone erase come back in its original z-order.

    @staticmethod
    def _apply(strokes, entry, forward):
        op = entry.get("op")
        items = entry.get("items") or []
        adding = (op == "add") == forward
        if adding:
            for it in sorted(items, key=lambda i: i.get("i", 0)):
                idx = min(max(0, int(it.get("i", len(strokes)))), len(strokes))
                strokes.insert(idx, it["s"])
        else:
            gone = {it["s"].get("id") for it in items}
            strokes[:] = [s for s in strokes if s.get("id") not in gone]
        return strokes

    def _push(self, page, entry):
        history = list(page.history or [])
        history.append(entry)
        page.history = history[-MAX_UNDO:]
        page.undone = []  # a fresh action discards the redo trail

    @database_sync_to_async
    def _commit_stroke(self, stroke):
        from .models import Board

        with transaction.atomic():
            _, page = self._page_locked()
            strokes = list(page.strokes or [])
            # A retried stroke_end must not double-commit.
            if any(s.get("id") == stroke["id"] for s in strokes):
                return
            strokes.append(stroke)
            self._push(page, {"op": "add", "items": [{"i": len(strokes) - 1, "s": stroke}]})
            if len(strokes) > MAX_STROKES_PER_PAGE:
                strokes = strokes[-MAX_STROKES_PER_PAGE:]
            page.strokes = strokes
            page.save(update_fields=["strokes", "history", "undone", "updated_at"])
            Board.objects.filter(pk=self.board_id).update(updated_at=page.updated_at)

    @database_sync_to_async
    def _erase(self, ids):
        with transaction.atomic():
            _, page = self._page_locked()
            wanted = set(ids)
            strokes = list(page.strokes or [])
            items = [
                {"i": i, "s": s} for i, s in enumerate(strokes) if s.get("id") in wanted
            ]
            if not items:
                return False
            entry = {"op": "del", "items": items}
            self._apply(strokes, entry, True)
            self._push(page, entry)
            page.strokes = strokes
            page.save(update_fields=["strokes", "history", "undone", "updated_at"])
            return True

    @database_sync_to_async
    def _history(self, action):
        with transaction.atomic():
            _, page = self._page_locked()
            strokes = list(page.strokes or [])
            history = list(page.history or [])
            undone = list(page.undone or [])

            if action == "clear":
                if not strokes:
                    return
                entry = {"op": "del", "items": [{"i": i, "s": s} for i, s in enumerate(strokes)]}
                self._apply(strokes, entry, True)
                history.append(entry)
                undone = []
            elif action == "undo":
                if not history:
                    return
                entry = history.pop()
                self._apply(strokes, entry, False)
                undone.append(entry)
            elif action == "redo":
                if not undone:
                    return
                entry = undone.pop()
                self._apply(strokes, entry, True)
                history.append(entry)
            else:
                return

            page.strokes = strokes
            page.history = history[-MAX_UNDO:]
            page.undone = undone[-MAX_UNDO:]
            page.save(update_fields=["strokes", "history", "undone", "updated_at"])

    @database_sync_to_async
    def _set_surface(self, surface):
        from .models import Board

        Board.objects.filter(pk=self.board_id).update(surface=surface)

    @database_sync_to_async
    def _goto_page(self, index):
        from .models import BoardPage, BoardSession

        with transaction.atomic():
            session = BoardSession.objects.select_for_update().get(board_id=self.board_id)
            if session.page_index == index:
                return False
            BoardPage.objects.get_or_create(board_id=self.board_id, index=index)
            session.page_index = index
            session.save(update_fields=["page_index"])
            return True

    @database_sync_to_async
    def _add_page(self):
        from .models import BoardPage, BoardSession

        with transaction.atomic():
            session = BoardSession.objects.select_for_update().get(board_id=self.board_id)
            used = set(
                BoardPage.objects.filter(board_id=self.board_id).values_list("index", flat=True)
            )
            if len(used) >= MAX_PAGES:
                return False
            idx = 0
            while idx in used:
                idx += 1
            BoardPage.objects.create(board_id=self.board_id, index=idx)
            session.page_index = idx
            session.save(update_fields=["page_index"])
            return True

    @database_sync_to_async
    def _delete_page(self):
        from .models import BoardPage, BoardSession

        with transaction.atomic():
            session = BoardSession.objects.select_for_update().get(board_id=self.board_id)
            pages = list(BoardPage.objects.filter(board_id=self.board_id).order_by("index"))
            if len(pages) <= 1:
                # Never leave a board with no page — wipe it instead.
                page = pages[0] if pages else None
                if page and (page.strokes or page.history or page.undone):
                    page.strokes = []
                    page.history = []
                    page.undone = []
                    page.save(update_fields=["strokes", "history", "undone", "updated_at"])
                    return True
                return False
            BoardPage.objects.filter(
                board_id=self.board_id, index=session.page_index
            ).delete()
            remaining = list(
                BoardPage.objects.filter(board_id=self.board_id).order_by("index")
            )
            session.page_index = remaining[-1].index
            session.save(update_fields=["page_index"])
            return True
