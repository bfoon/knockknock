"""Chalk realtime board.

Wire protocol — every frame is {"t": "<type>", ...}.

  client -> server        server -> room
  ---------------------   -------------------------------------------------
  hello {role, token}     ready {...}  |  denied {reason, code}
  stroke_start            stroke_start   (id, tool, color, w, pts)
  stroke_pts              stroke_pts     (id, pts)   -- appended, not replaced
  stroke_end              stroke_end     (id, ...)   -- full list, committed
  erase {ids}             erase          (ids, canUndo, canRedo)
  undo | redo | clear     ink            (add, del, canUndo, canRedo)
  surface {surface}       surface        (surface)
  page {index}            snapshot
  page_add | page_delete  snapshot
  pointer {x,y,on}        pointer        (laser, never stored)
  ping                    pong

Two things changed from the first pass and both matter:

1. A socket does NOT join the broadcast group until `hello` succeeds. It used
   to join in `connect()`, which meant anyone who knew the six digits could
   sit in the room and receive every stroke without ever authenticating.

2. The pairing is re-checked in the background every WATCH_INTERVAL seconds
   against `BoardSession.revision`. Rotating the code now genuinely evicts a
   phone that is already connected, instead of leaving it writing into the
   page invisibly.

Only `stroke_end` and the structural messages touch the database, so a normal
lesson still costs roughly one write per pen stroke. Undo/redo/clear used to
rebroadcast the entire page; they now broadcast the operation instead.
"""

import asyncio
import re
import time
from hmac import compare_digest

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.db import transaction

from .models import (
    MAX_HISTORY_ITEMS,
    MAX_PAGES,
    MAX_POINTS,
    MAX_STROKES_PER_PAGE,
    MAX_UNDO,
)

TOOLS = {"pen", "marker", "chalk", "highlighter"}
SURFACE_KEYS = {"black", "green", "white", "grid", "ruled"}

# Exactly the CSS colour forms that are real: #rgb, #rgba, #rrggbb, #rrggbbaa.
COLOR_RE = re.compile(r"^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")

HELLO_TIMEOUT = 10.0      # seconds a socket may sit unauthenticated
WATCH_INTERVAL = 20.0     # seconds between pairing re-checks
POINTER_MIN_GAP = 0.02    # laser frames are throttled to 50/s

# Crude per-socket flood guard. A human drawing hard peaks around 120 frames
# a second; anything sustained above this is not a person.
RATE_BURST = 400
RATE_PER_SEC = 200.0

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
    if f in (float("inf"), float("-inf")):
        return default
    return round(min(hi, max(lo, f)), 4)


def _is_int(v):
    """`isinstance(True, int)` is True in Python, and `{"index": true}` used
    to navigate to page 1. Booleans are not indices."""
    return isinstance(v, int) and not isinstance(v, bool)


def clean_points(raw, limit=MAX_POINTS):
    if not isinstance(raw, (list, tuple)):
        return []
    out = [_num(v) for v in raw[:limit]]
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


def _history_items(stacks):
    return sum(len(e.get("items") or []) for stack in stacks for e in stack)


class ChalkConsumer(AsyncJsonWebsocketConsumer):
    # ------------------------------------------------------------------
    # lifecycle
    # ------------------------------------------------------------------

    async def connect(self):
        self.code = self.scope["url_route"]["kwargs"]["code"]
        self.group = f"chalk_{self.code}"
        self.role = "guest"
        self.can_draw = False
        self.is_owner = False
        self.in_group = False
        self.closing = False
        self.last_pointer = 0.0
        self._tokens = RATE_BURST
        self._tokens_at = time.monotonic()
        self._reaper = None
        self._watcher = None

        info = await self._session_info(self.code)
        if not info:
            await self.close(code=4404)
            return
        if not info["live"]:
            await self.accept()
            await self._deny("This board number has expired.", "expired")
            return

        self.board_id = info["board_id"]
        self.owner_id = info["owner_id"]
        self.token = info["token"]
        self.revision = info["revision"]

        # NOTE: no group_add here. See module docstring, point 1.
        await self.accept()
        self._reaper = asyncio.create_task(self._reap_unauthenticated())

    async def disconnect(self, close_code):
        for task in (self._reaper, self._watcher):
            if task:
                task.cancel()
        if getattr(self, "in_group", False):
            if self.role in ("stage", "control"):
                await self._fan({"t": "peer", "role": self.role, "state": "left"})
            await self.channel_layer.group_discard(self.group, self.channel_name)
            self.in_group = False

    async def _reap_unauthenticated(self):
        """Close sockets that connect and then never say hello."""
        try:
            await asyncio.sleep(HELLO_TIMEOUT)
        except asyncio.CancelledError:
            return
        if not self.can_draw:
            await self._deny("This board did not finish pairing.", "timeout")

    async def _watch_pairing(self):
        """Re-check the pairing periodically and evict when it changes.

        This is the belt to the eviction broadcast's braces: even if the
        channel layer drops the kick message, a rotated code takes effect
        within WATCH_INTERVAL.
        """
        while True:
            try:
                await asyncio.sleep(WATCH_INTERVAL)
            except asyncio.CancelledError:
                return
            info = await self._session_info(self.code, extend=True)
            if not info or not info["live"] or info["revision"] != self.revision:
                await self._deny(
                    "This board number was regenerated. Scan the new one.", "expired"
                )
                return
            if not self.is_owner and not compare_digest(info["token"], self.token):
                await self._deny(
                    "This board number was regenerated. Scan the new one.", "expired"
                )
                return

    # ------------------------------------------------------------------
    # inbound
    # ------------------------------------------------------------------

    def _allow_frame(self):
        now = time.monotonic()
        self._tokens = min(
            RATE_BURST, self._tokens + (now - self._tokens_at) * RATE_PER_SEC
        )
        self._tokens_at = now
        if self._tokens < 1:
            return False
        self._tokens -= 1
        return True

    async def receive_json(self, content, **kwargs):
        if self.closing or not isinstance(content, dict):
            return
        if not self._allow_frame():
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
            raw = content.get("ids")
            ids = []
            if isinstance(raw, (list, tuple)):
                ids = [str(i) for i in raw if ID_RE.match(str(i))][:400]
            if ids:
                result = await self._erase(ids)
                if result:
                    await self._fan(
                        {
                            "t": "erase",
                            "ids": result["ids"],
                            "canUndo": result["canUndo"],
                            "canRedo": result["canRedo"],
                        },
                        echo=True,
                    )

        elif t in ("undo", "redo", "clear"):
            result = await self._history(t)
            if result and result["changed"]:
                await self._fan(
                    {
                        "t": "ink",
                        "add": result["add"],
                        "del": result["del"],
                        "canUndo": result["canUndo"],
                        "canRedo": result["canRedo"],
                    },
                    echo=True,
                )

        elif t == "surface":
            surface = content.get("surface")
            if surface in SURFACE_KEYS:
                await self._set_surface(surface)
                await self._fan({"t": "surface", "surface": surface}, echo=True)

        elif t == "page":
            idx = content.get("index")
            if _is_int(idx) and 0 <= idx < MAX_PAGES:
                if await self._goto_page(idx):
                    await self._broadcast_snapshot()

        elif t == "page_add":
            if await self._add_page():
                await self._broadcast_snapshot()

        elif t == "page_delete":
            if await self._delete_page():
                await self._broadcast_snapshot()

        elif t == "resync":
            # Explicit "I think I have drifted" request. Cheap safety valve
            # now that undo/redo no longer ships the whole page.
            state = await self._snapshot()
            await self.send_json({"t": "snapshot", **state})

        elif t == "pointer":
            now = time.monotonic()
            if now - self.last_pointer < POINTER_MIN_GAP:
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

    # ------------------------------------------------------------------
    # pairing
    # ------------------------------------------------------------------

    async def _hello(self, content):
        if self.can_draw:
            # Already paired. Replaying hello used to re-read the whole page
            # from the database and re-announce the peer, once per message.
            return

        role = content.get("role")
        token = str(content.get("token") or "")
        user = self.scope.get("user")
        self.is_owner = bool(
            user
            and getattr(user, "is_authenticated", False)
            and user.id == self.owner_id
        )

        if role == "stage":
            if not self.is_owner:
                return await self._deny(
                    "Only the person who owns this board can project it.", "not_owner"
                )
        elif role == "control":
            by_token = bool(token) and compare_digest(token, self.token)
            by_grant = await self._has_session_grant()
            if not (self.is_owner or by_token or by_grant):
                return await self._deny(
                    "This board number was regenerated. Scan the new one.", "bad_token"
                )
        else:
            return await self._deny("Unrecognised role.", "bad_role")

        self.role = role
        self.can_draw = True
        if self._reaper:
            self._reaper.cancel()
            self._reaper = None

        await self.channel_layer.group_add(self.group, self.channel_name)
        self.in_group = True
        self._watcher = asyncio.create_task(self._watch_pairing())

        state = await self._snapshot()
        await self.send_json({"t": "ready", "role": self.role, **state})
        await self._fan({"t": "peer", "role": self.role, "state": "joined"})

    async def _deny(self, reason, code="denied"):
        if self.closing:
            return
        self.closing = True
        try:
            await self.send_json({"t": "denied", "reason": reason, "code": code})
        finally:
            await self.close(code=4403)

    # ------------------------------------------------------------------
    # fanout
    # ------------------------------------------------------------------

    async def _fan(self, payload, echo=False):
        """`echo=True` sends the frame back to the originator too.

        Used for anything the sender cannot have applied correctly on its own
        — erases carry authoritative undo flags, and undo/redo ops are
        computed server-side.
        """
        await self.channel_layer.group_send(
            self.group,
            {
                "type": "fan.out",
                "payload": payload,
                "origin": "" if echo else self.channel_name,
            },
        )

    async def fan_out(self, event):
        payload = event["payload"]
        if event.get("origin") == self.channel_name and payload.get("t") in NO_ECHO:
            return
        await self.send_json(payload)

    async def kick(self, event):
        """Group message from views.RotateCodeView — evict everyone here."""
        await self._deny(
            event.get("reason", "This pairing is no longer valid."),
            event.get("code", "expired"),
        )

    async def _broadcast_snapshot(self):
        state = await self._snapshot()
        await self.channel_layer.group_send(
            self.group,
            {"type": "fan.out", "payload": {"t": "snapshot", **state}, "origin": ""},
        )

    # ------------------------------------------------------------------
    # database
    # ------------------------------------------------------------------

    @database_sync_to_async
    def _session_info(self, code, extend=False):
        from .models import BoardSession

        s = BoardSession.objects.select_related("board").filter(code=code).first()
        if not s:
            return None
        if extend and s.is_live:
            s.extend()
        return {
            "board_id": s.board_id,
            "owner_id": s.board.owner_id,
            "token": s.token,
            "revision": s.revision,
            "live": s.is_live,
        }

    @database_sync_to_async
    def _has_session_grant(self):
        """Was this browser handed a grant by ControlView?

        The phone's proof of pairing lives in its Django session, not in a
        token that has to survive a QR scan, a redirect and a JSON round-trip
        through the page. That round-trip was the reason a freshly scanned
        code could come back "pairing expired".
        """
        session = self.scope.get("session")
        if not session:
            return False
        grants = session.get("chalk_grants") or {}
        held = grants.get(str(self.board_id))
        return bool(held) and compare_digest(str(held), self.token)

    @database_sync_to_async
    def _snapshot(self):
        from .models import Board, BoardPage, BoardSession

        board = Board.objects.get(pk=self.board_id)
        session = BoardSession.objects.get(board=board)
        pages = list(BoardPage.objects.filter(board=board).order_by("index"))
        if not pages:
            pages = [board.ensure_page(0)]
        page = next((p for p in pages if p.index == session.page_index), None)
        if page is None:
            # The session points at a page that no longer exists. Land on the
            # last one rather than conjuring a blank via get_or_create.
            page = pages[-1]
            BoardSession.objects.filter(pk=session.pk).update(page_index=page.index)
        return {
            "title": board.title,
            "surface": board.surface,
            "pageIndex": page.index,
            "pageCount": len(pages),
            "strokes": page.strokes,
            "canUndo": bool(page.history),
            "canRedo": bool(page.undone),
        }

    def _page_locked(self):
        from .models import BoardPage, BoardSession

        session = BoardSession.objects.select_for_update().get(board_id=self.board_id)
        page = (
            BoardPage.objects.select_for_update()
            .filter(board_id=self.board_id, index=session.page_index)
            .first()
        )
        if page is None:
            page, _ = BoardPage.objects.get_or_create(
                board_id=self.board_id, index=session.page_index
            )
            page = BoardPage.objects.select_for_update().get(pk=page.pk)
        return session, page

    def _touch_board(self):
        from .models import Board

        Board.objects.filter(pk=self.board_id).update(updated_at=self._now())

    @staticmethod
    def _now():
        from django.utils import timezone

        return timezone.now()

    # -- history -------------------------------------------------------
    #
    # One undo stack and one redo stack, both holding the same entry shape:
    #     {"op": "add" | "del", "items": [{"i": <index>, "s": <stroke>}]}
    # "add" means those strokes were put on the board; "del" means they were
    # taken off. Undo applies the opposite, redo applies it again. Storing the
    # index lets an undone erase come back in its original z-order.

    @staticmethod
    def _apply(strokes, entry, forward):
        """Mutate `strokes` and return the ops needed to reproduce the change
        on a client: ({"add": [...], "del": [ids]})."""
        op = entry.get("op")
        items = [it for it in (entry.get("items") or []) if isinstance(it, dict) and "s" in it]
        adding = (op == "add") == forward
        if adding:
            placed = []
            for it in sorted(items, key=lambda i: i.get("i", 0)):
                idx = min(max(0, int(it.get("i", len(strokes)))), len(strokes))
                strokes.insert(idx, it["s"])
                placed.append({"i": idx, "s": it["s"]})
            return {"add": placed, "del": []}
        gone = {it["s"].get("id") for it in items}
        strokes[:] = [s for s in strokes if s.get("id") not in gone]
        return {"add": [], "del": sorted(i for i in gone if i)}

    @staticmethod
    def _trim_history(history, undone):
        """Bound both stacks by entry count AND by total strokes retained.

        Entry count alone was not enough: one `clear` on a full page copies
        every stroke into a single entry, so sixty entries could hold many
        times the page itself.
        """
        history = history[-MAX_UNDO:]
        undone = undone[-MAX_UNDO:]
        while _history_items([history, undone]) > MAX_HISTORY_ITEMS:
            if undone:
                undone.pop(0)
            elif history:
                history.pop(0)
            else:
                break
        return history, undone

    def _push(self, page, entry):
        history = list(page.history or [])
        history.append(entry)
        page.history, page.undone = self._trim_history(history, [])

    @database_sync_to_async
    def _commit_stroke(self, stroke):
        with transaction.atomic():
            _, page = self._page_locked()
            strokes = list(page.strokes or [])
            # A retried stroke_end must not double-commit.
            if any(s.get("id") == stroke["id"] for s in strokes):
                return
            strokes.append(stroke)
            self._push(
                page, {"op": "add", "items": [{"i": len(strokes) - 1, "s": stroke}]}
            )
            if len(strokes) > MAX_STROKES_PER_PAGE:
                # Dropping strokes invalidates every index held in history, so
                # the undo stack goes with them rather than silently
                # reinserting things at the wrong z-order.
                strokes = strokes[-MAX_STROKES_PER_PAGE:]
                page.history = []
                page.undone = []
            page.strokes = strokes
            page.save(update_fields=["strokes", "history", "undone", "updated_at"])
            self._touch_board()

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
                return None
            entry = {"op": "del", "items": items}
            ops = self._apply(strokes, entry, True)
            self._push(page, entry)
            page.strokes = strokes
            page.save(update_fields=["strokes", "history", "undone", "updated_at"])
            self._touch_board()
            return {
                "ids": ops["del"],
                "canUndo": bool(page.history),
                "canRedo": bool(page.undone),
            }

    @database_sync_to_async
    def _history(self, action):
        """Returns the ops to broadcast, or {"changed": False}.

        This used to return nothing and the caller broadcast a full snapshot
        unconditionally, so holding Undo on an empty stack rebroadcast the
        entire page to every socket, repeatedly.
        """
        idle = {"changed": False}
        with transaction.atomic():
            _, page = self._page_locked()
            strokes = list(page.strokes or [])
            history = list(page.history or [])
            undone = list(page.undone or [])

            if action == "clear":
                if not strokes:
                    return idle
                entry = {
                    "op": "del",
                    "items": [{"i": i, "s": s} for i, s in enumerate(strokes)],
                }
                ops = self._apply(strokes, entry, True)
                history.append(entry)
                undone = []
            elif action == "undo":
                if not history:
                    return idle
                entry = history.pop()
                ops = self._apply(strokes, entry, False)
                undone.append(entry)
            elif action == "redo":
                if not undone:
                    return idle
                entry = undone.pop()
                ops = self._apply(strokes, entry, True)
                history.append(entry)
            else:
                return idle

            history, undone = self._trim_history(history, undone)
            page.strokes = strokes
            page.history = history
            page.undone = undone
            page.save(update_fields=["strokes", "history", "undone", "updated_at"])
            self._touch_board()
            return {
                "changed": True,
                "add": ops["add"],
                "del": ops["del"],
                "canUndo": bool(history),
                "canRedo": bool(undone),
            }

    @database_sync_to_async
    def _set_surface(self, surface):
        from .models import Board

        Board.objects.filter(pk=self.board_id).update(
            surface=surface, updated_at=self._now()
        )

    # -- pages ---------------------------------------------------------
    #
    # Indices are dense: 0..count-1, always. The phone navigates by
    # `index + 1`, so a gap used to make "previous page" resurrect a page you
    # had just deleted, via get_or_create.

    @database_sync_to_async
    def _goto_page(self, index):
        from .models import BoardPage, BoardSession

        with transaction.atomic():
            session = BoardSession.objects.select_for_update().get(
                board_id=self.board_id
            )
            if session.page_index == index:
                return False
            if not BoardPage.objects.filter(
                board_id=self.board_id, index=index
            ).exists():
                return False  # navigation never creates a page
            session.page_index = index
            session.save(update_fields=["page_index"])
            self._touch_board()
            return True

    @database_sync_to_async
    def _add_page(self):
        from .models import BoardPage, BoardSession

        with transaction.atomic():
            session = BoardSession.objects.select_for_update().get(
                board_id=self.board_id
            )
            count = BoardPage.objects.filter(board_id=self.board_id).count()
            if count >= MAX_PAGES:
                return False
            BoardPage.objects.create(board_id=self.board_id, index=count)
            session.page_index = count
            session.save(update_fields=["page_index"])
            self._touch_board()
            return True

    @database_sync_to_async
    def _delete_page(self):
        from .models import Board, BoardPage, BoardSession

        with transaction.atomic():
            session = BoardSession.objects.select_for_update().get(
                board_id=self.board_id
            )
            board = Board.objects.get(pk=self.board_id)
            pages = list(BoardPage.objects.filter(board=board).order_by("index"))
            if len(pages) <= 1:
                # Never leave a board with no page — wipe it instead.
                page = pages[0] if pages else None
                if page and (page.strokes or page.history or page.undone):
                    page.strokes = []
                    page.history = []
                    page.undone = []
                    page.save(
                        update_fields=["strokes", "history", "undone", "updated_at"]
                    )
                    self._touch_board()
                    return True
                return False

            position = next(
                (i for i, p in enumerate(pages) if p.index == session.page_index), 0
            )
            BoardPage.objects.filter(pk=pages[position].pk).delete()
            remaining = board.renumber_pages()
            # Land on the neighbour, not on the last page in the board.
            session.page_index = min(position, remaining - 1)
            session.save(update_fields=["page_index"])
            self._touch_board()
            return True
