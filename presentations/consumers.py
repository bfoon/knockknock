"""
SessionConsumer — single WebSocket consumer that handles BOTH presenter and
participant roles in BOTH polls and games.

Poll answers are permanently auto-saved into polls.Response.
The live chart still updates immediately through WebSocket tally broadcasts.

──────────────────────────────────────────────────────────────────────────
NEW (synchronized question timer)
──────────────────────────────────────────────────────────────────────────
Every advance/back/goto stamps `LiveSession.question_started_at = now()` and
resets `time_extension_seconds = 0`. State payloads include the absolute
start time and the server clock so every client computes the SAME remaining
seconds — and even after a refresh the timer resumes from wherever it is
right now (not from the full `time_limit` again).

The presenter can extend the current question by sending {type:"extend_time",
seconds:5|10}. This bumps `time_extension_seconds` and rebroadcasts state.

Late answers are policed server-side using `quiz.allow_late_answers` and
`quiz.late_answer_points_pct`. With the default policy, an answer arriving
after the deadline is rejected; with late answers allowed, it is accepted
but scored at the configured reduced rate (0% by default).

──────────────────────────────────────────────────────────────────────────
NEW (picture choice + puzzle answers)
──────────────────────────────────────────────────────────────────────────
Game choices now ship `image_url`, `order`, and `correct_position` on the
wire so the participant can render picture cards and puzzle pieces, and so
the presenter chart can use image thumbnails as X-axis labels. The answer
recorder handles `puzzle_order` payloads (an array of choice IDs in the
order the participant arranged them).
"""

import json
import time
import uuid

from channels.generic.websocket import AsyncJsonWebsocketConsumer
from channels.db import database_sync_to_async
from django.utils import timezone


from .models import LiveSession, Participant


class SessionConsumer(AsyncJsonWebsocketConsumer):

    async def connect(self):
        self.code = self.scope["url_route"]["kwargs"]["code"]
        self.group = f"session_{self.code}"
        self.role = None
        self.uid = None
        self.session_pk = None
        # Per-connection cursor for OPEN (self-paced) mode. In orchestra mode
        # this is ignored and everyone follows session.current_question_index.
        # `None` means "not yet started self-pacing" — fall back to the session
        # index until the participant taps next/back themselves.
        self.self_index = None

        session = await self._get_session(self.code)
        if not session:
            await self.close(code=4404)
            return

        self.session_pk = session.pk

        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()

        await self.send_json(await self._state_payload(session))

    async def disconnect(self, code):
        if hasattr(self, "group"):
            await self.channel_layer.group_discard(self.group, self.channel_name)

    async def receive_json(self, content, **kwargs):
        t = content.get("type")

        handler = {
            "hello": self._on_hello,
            "advance": self._on_advance,
            "back": self._on_back,
            "goto": self._on_goto,
            "end": self._on_end,
            "answer": self._on_answer,
            "celebration_emoji": self._on_celebration_emoji,
            "self_advance": self._on_self_advance,
            "draw": self._on_draw,
            "clear_draw": self._on_clear_draw,
            "group_display": self._on_group_display,
            "fullscreen": self._on_fullscreen,
            "ping": self._on_ping,
            "room_join_request": self._on_room_join_request,
            "extend_time": self._on_extend_time,
            "reveal_answer": self._on_reveal_answer,
        }.get(t)

        if not handler:
            await self.send_json({
                "type": "error",
                "detail": f"unknown type {t}",
            })
            return

        await handler(content)

    async def _on_hello(self, msg):
        self.role = msg.get("role", "participant")
        self.uid = msg.get("uid") or str(uuid.uuid4())

        if self.role == "participant":
            existing = await self._get_participant(self.session_pk, self.uid)

            if existing:
                nickname = (msg.get("nickname") or existing["nickname"] or "Guest").strip()[:40]
                avatar_id = msg.get("avatar_id") or existing["avatar_id"] or "dragon"
            else:
                nickname = (msg.get("nickname") or "Guest").strip()[:40]
                avatar_id = msg.get("avatar_id") or "dragon"

            requested_room = msg.get("room_id") or ""

            await self._register_participant(
                self.session_pk,
                self.uid,
                nickname,
                avatar_id,
                requested_room,
            )

            await self._broadcast_state()
            # Rooms occupancy may have changed; refresh everyone's room view.
            await self._broadcast_rooms_update()

            session = await self._get_session(self.code)
            if session and session.kind == "game":
                lb = await self._leaderboard(self.session_pk)
                await self.channel_layer.group_send(
                    self.group,
                    {
                        "type": "broadcast",
                        "payload": {
                            "type": "leaderboard",
                            "data": lb,
                        },
                    },
                )

        session = await self._get_session(self.code)

        # In OPEN (self-paced) mode, seed this participant's personal cursor so
        # they begin at wherever the session currently is, then pace themselves.
        if (
            session
            and self.role == "participant"
            and session.mode == "open"
            and self.self_index is None
        ):
            if session.state == "running":
                self.self_index = max(0, session.current_question_index)
            elif session.state == "lobby":
                self.self_index = None  # wait in lobby until they tap start
            else:
                self.self_index = session.current_question_index

        await self.send_json(
            await self._state_payload(session, uid=self.uid, role=self.role)
        )

    async def _on_advance(self, msg):
        if self.role != "presenter":
            return

        session = await self._advance(self.session_pk, +1)
        await self._broadcast_state(session)

    async def _on_back(self, msg):
        if self.role != "presenter":
            return

        session = await self._advance(self.session_pk, -1)
        await self._broadcast_state(session)

    async def _on_goto(self, msg):
        if self.role != "presenter":
            return

        idx = int(msg.get("index", 0))
        session = await self._goto(self.session_pk, idx)
        await self._broadcast_state(session)

    async def _on_end(self, msg):
        if self.role != "presenter":
            return

        await self._end_session(self.session_pk)
        session = await self._get_session(self.code)
        await self._broadcast_state(session)

        await self.channel_layer.group_send(
            self.group,
            {
                "type": "broadcast",
                "payload": {"type": "ended"},
            },
        )

    async def _on_extend_time(self, msg):
        """Presenter clicked +5 / +10 in the toolbar."""
        if self.role != "presenter":
            return

        try:
            seconds = int(msg.get("seconds") or 0)
        except (TypeError, ValueError):
            seconds = 0

        seconds = max(1, min(120, seconds))

        session = await self._extend_time(self.session_pk, seconds)

        if session is None:
            return

        await self._broadcast_state(session)

    async def _on_reveal_answer(self, msg):
        """Reveal the correct answer after the server-side timer expires.

        The browser may ask for the reveal when its local countdown reaches
        zero, but the server still validates the real deadline using
        LiveSession.question_started_at + time_limit + extensions. This keeps
        participants from revealing the answer early by sending a manual socket
        message.
        """
        if self.role not in {"presenter", "participant"}:
            return

        payload = await self._correct_answer_payload(self.session_pk)
        if not payload:
            return

        await self.channel_layer.group_send(
            self.group,
            {
                "type": "broadcast",
                "payload": payload,
            },
        )

    async def _on_answer(self, msg):
        if self.role != "participant":
            return

        result = await self._record_answer(
            self.session_pk,
            self.uid,
            question_id=msg.get("question_id"),
            choice_id=msg.get("choice_id"),
            text=msg.get("text"),
            value=msg.get("value"),
            puzzle_order=msg.get("puzzle_order"),
            client_received_at=msg.get("question_received_at"),
            choice_ids=msg.get("choice_ids"),
            ordered_ids=msg.get("ordered_ids"),
            matrix=msg.get("matrix"),
            points=msg.get("points"),
            x=msg.get("x"),
            y=msg.get("y"),
            datetime_kind=msg.get("datetime_kind"),
            file_payload=msg.get("file"),
        )

        if result.get("kind") == "game":
            # If the server rejected the answer because the timer ran out and
            # late answers are not allowed, tell the client so it can show a
            # clean "Time's up — no points" state.
            if result.get("rejected_reason") == "deadline":
                await self.send_json({
                    "type": "answer_rejected",
                    "question_id": msg.get("question_id"),
                    "reason": "deadline",
                })
                return

            await self.send_json({
                "type": "answer_ack",
                "question_id": msg.get("question_id"),
                "choice_id": msg.get("choice_id"),
                "question_type": result.get("question_type"),
                "puzzle_order": result.get("puzzle_order") or [],
                "is_correct": result.get("is_correct"),
                "points": result.get("points"),
                "score": result.get("score"),
                "was_late": result.get("was_late", False),
            })

            lb = await self._leaderboard(self.session_pk)

            await self.channel_layer.group_send(
                self.group,
                {
                    "type": "broadcast",
                    "payload": {
                        "type": "leaderboard",
                        "data": lb,
                    },
                },
            )

        # Reaction questions should feel alive on the presenter screen.
        # We still broadcast the normal tally below so the chart remains visible,
        # but we also send a lightweight animation event for the exact emoji tapped.
        if result.get("kind") == "poll" and result.get("question_type") == "reaction":
            emoji = (
                result.get("choice_text")
                or result.get("text")
                or msg.get("text")
                or "✨"
            )
            await self.channel_layer.group_send(
                self.group,
                {
                    "type": "broadcast",
                    "payload": {
                        "type": "reaction_burst",
                        "question_id": msg.get("question_id"),
                        "choice_id": result.get("choice_id") or msg.get("choice_id"),
                        "emoji": str(emoji)[:12],
                        "participant_uid": self.uid,
                    },
                },
            )

        # For GAME sessions we hold the live tally back until the timer
        # expires (see _on_reveal_answer / _correct_answer_payload below).
        # Showing a running chart while the round is still open lets
        # late-clicking participants see which answer is winning and
        # copy it — that defeats the whole point of a timed quiz.
        # Polls still get the live chart on every submission, including
        # the reaction-burst path above, because that's the experience
        # we want there.
        if result.get("kind") == "game":
            return

        tally = await self._tally(self.session_pk, msg.get("question_id"))

        await self.channel_layer.group_send(
            self.group,
            {
                "type": "broadcast",
                "payload": {
                    "type": "tally",
                    "question_id": msg.get("question_id"),
                    "data": tally,
                },
            },
        )


    async def _on_celebration_emoji(self, msg):
        """Let participants send a small emoji burst on the final screen."""
        if self.role != "participant":
            return

        emoji = str(msg.get("emoji") or "🎉").strip()[:12] or "🎉"
        participant = await self._get_participant(self.session_pk, self.uid)

        await self.channel_layer.group_send(
            self.group,
            {
                "type": "broadcast",
                "payload": {
                    "type": "celebration_emoji",
                    "emoji": emoji,
                    "participant_uid": self.uid,
                    "participant_name": (participant or {}).get("nickname") or "Guest",
                    "avatar_id": (participant or {}).get("avatar_id") or "dragon",
                },
            },
        )

    async def _on_self_advance(self, msg):
        """Open (self-paced) mode: move THIS participant's own cursor.

        Orchestra mode ignores this entirely — participants follow the
        presenter. In open mode each participant walks the deck at their own
        speed without affecting anyone else.

        msg.direction: "next" (default) | "back"
        msg.index:     optional absolute jump (used on first tap from lobby)
        """
        if self.role != "participant":
            await self.send_json({"type": "self_advance_ack"})
            return

        session = await self._get_session(self.code)
        if not session:
            return

        # Only self-pace in open mode. In orchestra mode, ack and do nothing
        # so the participant stays locked to the presenter's index.
        if session.mode != "open":
            await self.send_json({"type": "self_advance_ack", "locked": True})
            return

        total = await self._question_count(self.session_pk)
        if total <= 0:
            await self.send_json({"type": "self_advance_ack", "total": 0})
            return

        # Starting point: personal cursor if set, else the session index.
        # If the session is still in lobby (presenter hasn't pressed start),
        # an open-mode participant may begin the deck themselves at Q0.
        base = self.self_index
        if base is None:
            if session.state == "lobby":
                base = -1  # first "next" lands on 0
            else:
                base = max(0, session.current_question_index)

        # Absolute jump?
        if msg.get("index") is not None:
            try:
                target = int(msg.get("index"))
            except (TypeError, ValueError):
                target = base
        else:
            direction = (msg.get("direction") or "next").lower()
            delta = -1 if direction == "back" else +1
            target = base + delta

        # Past the end → this participant has finished the deck.
        if target >= total:
            self.self_index = total  # sentinel = "finished"
            await self.send_json({
                "type": "self_finished",
                "total": total,
            })
            return

        target = max(0, min(total - 1, target))
        self.self_index = target

        # Send this participant their own question view (no group broadcast —
        # self-pacing is private to this connection).
        await self.send_json(
            await self._state_payload(session, uid=self.uid, role=self.role)
        )

    async def _on_draw(self, msg):
        if self.role != "presenter":
            return

        await self.channel_layer.group_send(
            self.group,
            {
                "type": "broadcast",
                "payload": {
                    "type": "draw",
                    "ev": msg.get("ev"),
                    "x": msg.get("x"),
                    "y": msg.get("y"),
                    "color": msg.get("color"),
                    "size": msg.get("size"),
                    "tool": msg.get("tool"),
                },
            },
        )

    async def _on_clear_draw(self, msg):
        if self.role != "presenter":
            return

        await self.channel_layer.group_send(
            self.group,
            {
                "type": "broadcast",
                "payload": {"type": "clear_draw"},
            },
        )

    async def _on_group_display(self, msg):
        if self.role != "presenter":
            return

        await self.channel_layer.group_send(
            self.group,
            {
                "type": "broadcast",
                "payload": {
                    "type": "group_display",
                    "enabled": bool(msg.get("enabled")),
                },
            },
        )

    async def _on_fullscreen(self, msg):
        if self.role != "presenter":
            return

        await self.channel_layer.group_send(
            self.group,
            {
                "type": "broadcast",
                "payload": {"type": "fullscreen"},
            },
        )

    async def _on_ping(self, msg):
        await self.send_json({
            "type": "pong",
            "t": time.time(),
        })

    async def _on_room_join_request(self, msg):
        """Participant tapped a specific room's door."""
        if self.role != "participant":
            return

        room_slug = (msg.get("room_id") or "").strip()
        if not room_slug:
            await self.send_json({"type": "room_join_result", "ok": False, "reason": "missing"})
            return

        result = await self._try_seat_in_room(self.session_pk, self.uid, room_slug)

        await self.send_json({
            "type": "room_join_result",
            "ok": result["ok"],
            "reason": result.get("reason", ""),
            "room_id": room_slug,
            "room": result.get("room"),
        })

        if result["ok"]:
            await self._broadcast_rooms_update()

    async def broadcast(self, event):
        payload = event["payload"]

        # A replay rewinds the session to the lobby (see presentations.views
        # .replay). Reset this connection's self-paced cursor so participants
        # restart cleanly, then hand them a fresh state payload instead of the
        # bare "replay" notice.
        if payload.get("type") == "replay":
            self.self_index = None
            session = await self._get_session(self.code)
            if session:
                payload = await self._state_payload(
                    session, uid=self.uid, role=self.role
                )
            else:
                await self.send_json({"type": "replay"})
                return

        if payload.get("type") == "state" and self.role == "participant" and self.uid:
            session = await self._get_session(self.code)
            payload = await self._state_payload(session, uid=self.uid, role=self.role)

        await self.send_json(payload)

    async def _broadcast_state(self, session=None):
        if session is None:
            session = await self._get_session(self.code)

        payload = await self._state_payload(session)

        await self.channel_layer.group_send(
            self.group,
            {
                "type": "broadcast",
                "payload": payload,
            },
        )

    async def _broadcast_rooms_update(self):
        rooms = await self._rooms_snapshot(self.session_pk)
        if rooms is None:
            return

        await self.channel_layer.group_send(
            self.group,
            {
                "type": "broadcast",
                "payload": {
                    "type": "rooms",
                    "rooms": rooms,
                },
            },
        )

    @database_sync_to_async
    def _get_session(self, code):
        try:
            return (
                LiveSession.objects
                .select_related("questionnaire", "quiz")
                .get(code=code)
            )
        except LiveSession.DoesNotExist:
            return None

    @database_sync_to_async
    def _question_count(self, session_pk):
        """Number of questions in this session's deck (open-mode bounds)."""
        try:
            session = (
                LiveSession.objects
                .select_related("questionnaire", "quiz")
                .get(pk=session_pk)
            )
        except LiveSession.DoesNotExist:
            return 0
        return len(session.questions())

    @database_sync_to_async
    def _get_participant(self, session_pk, uid):
        try:
            p = Participant.objects.get(
                session_id=session_pk,
                participant_uid=uid,
            )
            return {
                "nickname": p.nickname,
                "avatar_id": p.avatar_id,
                "score": p.score or 0,
                "room_id": p.room_id or "",
            }
        except Participant.DoesNotExist:
            return None

    @database_sync_to_async
    def _register_participant(self, session_pk, uid, nickname, avatar_id, requested_room=""):
        """Persist (or refresh) a participant. (Unchanged.)"""
        from games.models import GameRoom

        session = LiveSession.objects.get(pk=session_pk)

        existing = Participant.objects.filter(
            session=session,
            participant_uid=uid,
        ).first()

        room_id = ""

        uses_rooms = (
            session.kind == "game"
            and session.quiz
            and session.quiz.use_rooms
        )

        named_rooms = []
        if uses_rooms:
            named_rooms = list(session.quiz.rooms.all())

        if existing and existing.room_id:
            if not named_rooms or any(r.slug == existing.room_id for r in named_rooms):
                room_id = existing.room_id

        elif uses_rooms and named_rooms and requested_room:
            target = next((r for r in named_rooms if r.slug == requested_room), None)
            if target:
                cap = session.quiz.room_capacity
                occupied = (
                    Participant.objects
                    .filter(session=session, room_id=target.slug)
                    .count()
                )
                if occupied < cap:
                    room_id = target.slug

        elif uses_rooms and not named_rooms:
            cap = session.quiz.room_capacity

            from collections import Counter
            occupancy = Counter(
                Participant.objects
                .filter(session=session)
                .exclude(room_id="")
                .values_list("room_id", flat=True)
            )

            chosen = None
            for rid, count in occupancy.items():
                if count < cap:
                    chosen = rid
                    break

            if not chosen:
                chosen = f"room-{len(occupancy) + 1}"

            room_id = chosen

        Participant.objects.update_or_create(
            session=session,
            participant_uid=uid,
            defaults={
                "nickname": nickname,
                "avatar_id": avatar_id,
                "room_id": room_id,
            },
        )

    @database_sync_to_async
    def _try_seat_in_room(self, session_pk, uid, room_slug):
        """Atomically try to put this participant in the named room. (Unchanged.)"""
        from django.db import transaction
        from games.models import GameRoom

        with transaction.atomic():
            session = LiveSession.objects.select_for_update().get(pk=session_pk)

            if not (session.quiz and session.quiz.use_rooms):
                return {"ok": False, "reason": "rooms_disabled", "room": None}

            try:
                room = GameRoom.objects.get(quiz=session.quiz, slug=room_slug)
            except GameRoom.DoesNotExist:
                return {"ok": False, "reason": "no_such_room", "room": None}

            participant = (
                Participant.objects
                .select_for_update()
                .filter(session=session, participant_uid=uid)
                .first()
            )
            if not participant:
                return {"ok": False, "reason": "not_joined", "room": None}

            if participant.room_id == room.slug:
                return {
                    "ok": True,
                    "reason": "already_in",
                    "room": {"slug": room.slug, "name": room.name, "avatar_id": room.avatar_id},
                }

            cap = session.quiz.room_capacity
            occupied = (
                Participant.objects
                .filter(session=session, room_id=room.slug)
                .exclude(pk=participant.pk)
                .count()
            )
            if occupied >= cap:
                return {"ok": False, "reason": "full", "room": None}

            participant.room_id = room.slug
            participant.save(update_fields=["room_id"])

            return {
                "ok": True,
                "reason": "granted",
                "room": {"slug": room.slug, "name": room.name, "avatar_id": room.avatar_id},
            }

    @database_sync_to_async
    def _rooms_snapshot(self, session_pk):
        from collections import Counter
        from games.models import GameRoom

        session = (
            LiveSession.objects
            .select_related("quiz")
            .get(pk=session_pk)
        )

        if not (session.kind == "game" and session.quiz and session.quiz.use_rooms):
            return None

        rooms = list(GameRoom.objects.filter(quiz=session.quiz).order_by("order", "id"))
        if not rooms:
            return None

        cap = session.quiz.room_capacity

        occupancy = Counter(
            Participant.objects
            .filter(session=session)
            .exclude(room_id="")
            .values_list("room_id", flat=True)
        )

        return [
            {
                "slug": r.slug,
                "name": r.name,
                "avatar_id": r.avatar_id,
                "capacity": cap,
                "occupancy": occupancy.get(r.slug, 0),
                "is_full": occupancy.get(r.slug, 0) >= cap,
            }
            for r in rooms
        ]

    # ───────── advance / goto / extend — timer-aware ─────────

    def _stamp_question_start(self, session, idx, total):
        """Set question_started_at and clear the time extension whenever the
        active question index changes. Caller must `save()`."""
        if session.state == "running" and 0 <= idx < total:
            session.question_started_at = timezone.now()
            session.time_extension_seconds = 0
        else:
            session.question_started_at = None
            session.time_extension_seconds = 0

    @database_sync_to_async
    def _advance(self, session_pk, delta):
        session = (
            LiveSession.objects
            .select_related("questionnaire", "quiz")
            .get(pk=session_pk)
        )

        total = len(session.questions())

        if total == 0:
            return session

        if session.state == "lobby":
            if delta > 0:
                session.state = "running"
                session.current_question_index = 0
                session.ended_at = None
                self._stamp_question_start(session, 0, total)
                session.save(update_fields=[
                    "state", "current_question_index", "ended_at",
                    "question_started_at", "time_extension_seconds",
                ])
            return session

        if session.state == "ended":
            if delta < 0:
                session.state = "running"
                session.current_question_index = max(0, total - 1)
                session.ended_at = None
                self._stamp_question_start(session, session.current_question_index, total)
                session.save(update_fields=[
                    "state", "current_question_index", "ended_at",
                    "question_started_at", "time_extension_seconds",
                ])
            return session

        current_idx = max(0, min(total - 1, session.current_question_index))

        if delta > 0 and current_idx >= total - 1:
            session.state = "ended"
            session.current_question_index = current_idx
            session.ended_at = timezone.now()
            session.question_started_at = None
            session.time_extension_seconds = 0
            session.save(update_fields=[
                "state", "current_question_index", "ended_at",
                "question_started_at", "time_extension_seconds",
            ])
            return session

        new_idx = max(0, min(total - 1, current_idx + delta))
        session.current_question_index = new_idx
        self._stamp_question_start(session, new_idx, total)
        session.save(update_fields=[
            "current_question_index",
            "question_started_at", "time_extension_seconds",
        ])

        return session

    @database_sync_to_async
    def _goto(self, session_pk, idx):
        session = (
            LiveSession.objects
            .select_related("questionnaire", "quiz")
            .get(pk=session_pk)
        )

        total = len(session.questions())

        session.state = "running" if total else "lobby"
        session.current_question_index = max(0, min(max(0, total - 1), idx))
        self._stamp_question_start(session, session.current_question_index, total)
        session.save(update_fields=[
            "state", "current_question_index",
            "question_started_at", "time_extension_seconds",
        ])

        return session

    @database_sync_to_async
    def _extend_time(self, session_pk, seconds):
        """Add `seconds` to the current question's extension."""
        try:
            session = LiveSession.objects.get(pk=session_pk)
        except LiveSession.DoesNotExist:
            return None

        if session.state != "running" or session.question_started_at is None:
            return None

        # Cap total extension at 5 minutes so a fat-finger doesn't run wild.
        session.time_extension_seconds = min(
            300,
            (session.time_extension_seconds or 0) + max(1, int(seconds)),
        )
        session.save(update_fields=["time_extension_seconds"])
        return session

    @database_sync_to_async
    def _end_session(self, session_pk):
        LiveSession.objects.filter(pk=session_pk).update(
            state="ended",
            ended_at=timezone.now(),
            question_started_at=None,
            time_extension_seconds=0,
        )


    # ───────── poll helpers (unchanged) ─────────

    def _scale_bounds_for(self, question):
        config = getattr(question, "config", None) or {}
        meta = {}
        try:
            meta = question.meta() or {}
        except Exception:
            meta = {}

        raw_min = config.get("scale_min", config.get("min", meta.get("scale_min", 1)))
        raw_max = config.get("scale_max", config.get("max", meta.get("scale_max", 10)))

        try:
            min_v = int(raw_min)
        except Exception:
            min_v = 1
        try:
            max_v = int(raw_max)
        except Exception:
            max_v = 10

        min_v = max(1, min(10, min_v))
        max_v = max(2, min(10, max_v))
        if min_v >= max_v:
            min_v, max_v = 1, 10
        return min_v, max_v

    def _scale_choices_for(self, question):
        min_v, max_v = self._scale_bounds_for(question)
        return [
            {"id": i, "text": str(i), "value": i}
            for i in range(min_v, max_v + 1)
        ]

    def _poll_choices_payload(self, question):
        q_type = getattr(question, "type", None)

        if q_type == "scale":
            return self._scale_choices_for(question)

        try:
            if hasattr(question, "has_choices") and not question.has_choices():
                return []
        except Exception:
            pass

        if q_type in {
            "open", "word", "numeric", "rating", "nps", "slider",
            "date", "time", "datetime", "file_upload",
            "pin_image", "pin_map", "two_by_two",
        }:
            return []

        rows = []
        for c in question.choices.all():
            try:
                img_url = c.image.url if c.image and c.image.name else ""
            except (ValueError, AttributeError):
                img_url = ""
            rows.append({
                "id": c.id,
                "text": c.text,
                "image_url": img_url,
            })
        return rows

    def _numeric_bucket_key(self, value):
        try:
            number = float(value)
        except Exception:
            return None
        if number.is_integer():
            return str(int(number))
        return str(number)

    # ───────── game choice payload (now with image_url + ordering) ─────────

    def _game_choices_payload(self, question, role):
        """Serialize choices for a game question.

        We send `image_url`, `correct_position`, and `order` so the
        participant can render picture cards / puzzle pieces, and so the
        presenter chart can use image thumbnails as X-axis labels.

        We DO NOT leak `is_correct` to participants — only the presenter
        gets that. (Anything sent over the socket is visible in the
        browser's devtools, so a participant who looks at the JSON would
        otherwise see the answer key.)
        """
        rows = []
        for c in question.choices.all().order_by("order", "id"):
            try:
                image_url = c.image.url if c.image and c.image.name else ""
            except (ValueError, AttributeError):
                image_url = ""

            row = {
                "id": c.id,
                "text": c.text or "",
                "image_url": image_url,
                "order": c.order or 0,
                "correct_position": c.correct_position or 0,
            }
            if role == "presenter":
                row["is_correct"] = bool(c.is_correct)
            rows.append(row)
        return rows

    @database_sync_to_async
    def _correct_answer_payload(self, session_pk):
        """Return a safe reveal payload only after the timer has expired."""
        from games.models import GameChoice

        session = (
            LiveSession.objects
            .select_related("quiz")
            .get(pk=session_pk)
        )

        if session.kind != "game" or not session.quiz:
            return None

        questions = session.questions()
        idx = session.current_question_index
        question = questions[idx] if 0 <= idx < len(questions) else None
        if not question:
            return None

        if not session.question_started_at:
            return None

        total_allowed = int(question.time_limit or 0) + int(session.time_extension_seconds or 0)
        seconds_since_start = (timezone.now() - session.question_started_at).total_seconds()

        # Allow a small grace so every browser reaches zero before reveal.
        if seconds_since_start < max(0, total_allowed) - 0.25:
            return None

        question_type = getattr(question, "question_type", "mcq") or "mcq"

        def choice_row(choice):
            try:
                image_url = choice.image.url if choice.image and choice.image.name else ""
            except (ValueError, AttributeError):
                image_url = ""
            return {
                "id": choice.id,
                "text": choice.text or "",
                "image_url": image_url,
                "correct_position": choice.correct_position or 0,
                "order": choice.order or 0,
            }

        if question_type == "puzzle":
            correct_choices = [
                choice_row(c)
                for c in question.choices.filter(correct_position__gt=0).order_by("correct_position", "id")
            ]
            correct_order = [c["id"] for c in correct_choices]
            correct_choice_ids = correct_order
        else:
            correct_choices = [
                choice_row(c)
                for c in question.choices.filter(is_correct=True).order_by("order", "id")
            ]
            correct_choice_ids = [c["id"] for c in correct_choices]
            correct_order = []

        # Game answers don't broadcast tallies on submission (see
        # _on_answer above) — the chart is intentionally hidden during
        # the round. Bundle the final tally INTO this reveal payload
        # so the presenter screen can render the chart and the
        # correct-answer overlay at the same moment the timer ends.
        tally = self._game_tally_payload(session, question.id)

        return {
            "type": "correct_answer",
            "reason": "timer_ended",
            "question_id": question.id,
            "question_type": question_type,
            "correct_choice_ids": correct_choice_ids,
            "correct_order": correct_order,
            "correct_choices": correct_choices,
            "tally": tally,
        }

    @database_sync_to_async
    def _state_payload(self, session, uid=None, role=None):
        questions = session.questions()

        # ── Choose the active question index ──
        # Orchestra mode: everyone follows session.current_question_index.
        # Open (self-paced) mode: a participant with a personal cursor sees
        # THEIR question; the presenter still sees the session index.
        idx = session.current_question_index
        self_paced = (
            session.mode == "open"
            and role == "participant"
            and self.self_index is not None
        )
        if self_paced:
            idx = self.self_index

        current = questions[idx] if 0 <= idx < len(questions) else None

        question_data = None

        if current:
            if session.kind == "poll":
                title_image_url = ""
                try:
                    if getattr(current, "title_image", None) and current.title_image.name:
                        title_image_url = current.title_image.url
                except (ValueError, AttributeError):
                    title_image_url = ""

                # Question background image (used by pin_image questions).
                q_image_url = ""
                try:
                    if getattr(current, "image", None) and current.image.name:
                        q_image_url = current.image.url
                except (ValueError, AttributeError):
                    q_image_url = ""

                # Matrix rows (only meaningful for type == "matrix").
                matrix_rows_payload = []
                try:
                    for row in current.matrix_rows.all():
                        matrix_rows_payload.append({
                            "id": row.id,
                            "text": row.text,
                            "order": row.order,
                        })
                except Exception:
                    matrix_rows_payload = []

                question_data = {
                    "id": current.id,
                    "text": current.text,
                    "type": current.type,
                    "chart_type": current.chart_type,
                    "choices": self._poll_choices_payload(current),
                    "matrix_rows": matrix_rows_payload,
                    "config": getattr(current, "config", {}) or {},
                    "scale_min": self._scale_bounds_for(current)[0],
                    "scale_max": self._scale_bounds_for(current)[1],
                    "min_selections": getattr(current, "min_selections", None),
                    "max_selections": getattr(current, "max_selections", None),
                    "image_url": q_image_url,
                    "font_family": getattr(current, "font_family", "clash"),
                    "font_size": getattr(current, "font_size", 44),
                    "font_bold": getattr(current, "font_bold", True),
                    "subtitle": getattr(current, "subtitle", "") or "",
                    "title_layout": getattr(current, "title_layout", "clean") or "clean",
                    "title_image_url": title_image_url,
                    "title_author": getattr(current, "title_author", "") or "",
                }
            else:
                # Game question — now includes the styling fields, the
                # question_type, and image-aware choice rows.
                try:
                    qimage_url = current.image.url if current.image and current.image.name else ""
                except (ValueError, AttributeError):
                    qimage_url = ""

                question_data = {
                    "id": current.id,
                    "text": current.text,
                    "question_type": getattr(current, "question_type", "mcq"),
                    "type": getattr(current, "question_type", "mcq"),
                    "image_url": qimage_url,
                    "time_limit": current.time_limit,
                    "points": current.points,
                    "choices": self._game_choices_payload(current, role),
                    "font_family": getattr(current, "font_family", "default"),
                    "font_size": getattr(current, "font_size", 32),
                    "font_bold": getattr(current, "font_bold", True),
                    "text_italic": getattr(current, "text_italic", False),
                    "text_underline": getattr(current, "text_underline", False),
                    "text_align": getattr(current, "text_align", "center"),
                    "text_color": getattr(current, "text_color", "#f8fafc"),
                    "background_color": getattr(current, "background_color", "#1e293b"),
                    "background_gradient_to": getattr(current, "background_gradient_to", "") or "",
                    "answer_shape": getattr(current, "answer_shape", "rounded"),
                }

        # ── Synchronized timer fields ──
        # We send `question_started_at_ms` (absolute, milliseconds since epoch)
        # AND `server_time_ms` so the client can compute its own clock skew
        # and figure out exactly how many seconds are left right NOW.
        started_at_ms = None
        if session.question_started_at:
            started_at_ms = int(session.question_started_at.timestamp() * 1000)

        # Late-answer policy — only meaningful for games.
        allow_late = False
        late_pct = 0
        if session.kind == "game" and session.quiz:
            allow_late = bool(getattr(session.quiz, "allow_late_answers", False))
            late_pct = int(getattr(session.quiz, "late_answer_points_pct", 0) or 0)

        payload = {
            "type": "state",
            "code": session.code,
            "kind": session.kind,
            "state": session.state,
            "mode": session.mode,
            "title": session.title,
            "template_id": session.template_id,
            "index": idx,
            "total": len(questions),
            # Self-pace awareness for the participant client:
            #  - is_self_paced: this client is walking the deck on its own
            #  - can_self_advance: open mode + session running/has questions
            "is_self_paced": bool(self_paced),
            "can_self_advance": bool(
                session.mode == "open"
                and role == "participant"
                and session.state in ("lobby", "running", "ended")
                and len(questions) > 0
            ),
            "question": question_data,
            "participants": session.participants.count(),
            "chart_background": getattr(
                getattr(session, "quiz", None),
                "chart_background",
                "normal",
            ),
            # Timer
            "question_started_at_ms": started_at_ms,
            "time_extension_seconds": int(session.time_extension_seconds or 0),
            "server_time_ms": int(time.time() * 1000),
            # Late-answer policy
            "allow_late_answers": allow_late,
            "late_answer_points_pct": late_pct,
        }

        if (
            session.kind == "game"
            and session.quiz
            and session.quiz.use_rooms
        ):
            from collections import Counter
            from games.models import GameRoom

            rooms_qs = list(GameRoom.objects.filter(quiz=session.quiz).order_by("order", "id"))
            if rooms_qs:
                cap = session.quiz.room_capacity
                occupancy = Counter(
                    Participant.objects
                    .filter(session=session)
                    .exclude(room_id="")
                    .values_list("room_id", flat=True)
                )
                payload["rooms"] = [
                    {
                        "slug": r.slug,
                        "name": r.name,
                        "avatar_id": r.avatar_id,
                        "capacity": cap,
                        "occupancy": occupancy.get(r.slug, 0),
                        "is_full": occupancy.get(r.slug, 0) >= cap,
                    }
                    for r in rooms_qs
                ]

        if uid and role == "participant":
            try:
                me = Participant.objects.get(
                    session=session,
                    participant_uid=uid,
                )
            except Participant.DoesNotExist:
                me = None

            if me:
                payload["my_nickname"] = me.nickname
                payload["my_avatar"] = me.avatar_id
                payload["my_score"] = me.score or 0
                payload["my_room"] = me.room_id or ""

            if current and me:
                payload["my_answer"] = self._my_answer_for(session, current, uid)

        if current:
            # Games hide the tally until the question's timer is up
            # (matches the live-broadcast rule in _on_answer). If a
            # presenter reloads mid-round, the snapshot must NOT
            # carry a chart back to them. Polls always include the
            # tally because their chart is part of the live UX.
            include_tally = True
            if session.kind == "game":
                include_tally = False
                started = session.question_started_at
                if started:
                    total_allowed = (
                        int(getattr(current, "time_limit", 0) or 0)
                        + int(session.time_extension_seconds or 0)
                    )
                    elapsed = (timezone.now() - started).total_seconds()
                    # Match the 0.25s grace used by _correct_answer_payload
                    # so the chart appears exactly when the reveal does.
                    if elapsed >= max(0, total_allowed) - 0.25:
                        include_tally = True
            if include_tally:
                payload["tally"] = self._sync_tally(session, current.id)

        return payload

    def _my_answer_for(self, session, current_q, uid):
        if session.kind == "poll":
            from polls.models import Response as PollResp

            qtype = getattr(current_q, "type", None)

            # ── Ranking: return ordered list of choice_ids (highest first).
            if qtype == "ranking":
                rows = list(
                    PollResp.objects
                    .filter(session=session, question=current_q, participant_id=uid)
                    .exclude(choice__isnull=True)
                    .order_by("-numeric_value", "id")
                )
                if not rows:
                    return None
                return {
                    "choice_ids": [r.choice_id for r in rows],
                }

            # ── Multi-choice: list of choice_ids.
            if qtype in ("mcq", "image_choice"):
                rows = list(
                    PollResp.objects
                    .filter(session=session, question=current_q, participant_id=uid)
                    .exclude(choice__isnull=True)
                )
                if not rows:
                    return None
                if len(rows) == 1:
                    return {
                        "choice_id": rows[0].choice_id,
                        "choice_ids": [rows[0].choice_id],
                        "text": rows[0].text_value or "",
                    }
                return {
                    "choice_ids": [r.choice_id for r in rows],
                }

            # ── Matrix: dict of {row_id: numeric_value}.
            if qtype == "matrix":
                try:
                    from polls.models import MatrixAnswer
                except Exception:
                    MatrixAnswer = None
                if MatrixAnswer is None:
                    return None
                rows = list(
                    MatrixAnswer.objects
                    .filter(session=session, question=current_q, participant_id=uid)
                )
                if not rows:
                    return None
                return {
                    "matrix": {str(r.matrix_row_id): r.numeric_value for r in rows},
                }

            # ── Points allocation: dict of {choice_id: points}.
            if qtype == "points_allocation":
                try:
                    from polls.models import PointsAllocation
                except Exception:
                    PointsAllocation = None
                if PointsAllocation is None:
                    return None
                rows = list(
                    PointsAllocation.objects
                    .filter(session=session, question=current_q, participant_id=uid)
                )
                if not rows:
                    return None
                return {
                    "points": {str(r.choice_id): r.points for r in rows},
                }

            # ── Default single-row case (everything else).
            r = (
                PollResp.objects
                .filter(session=session, question=current_q, participant_id=uid)
                .order_by("-id")
                .first()
            )

            if not r:
                return None

            out = {
                "choice_id": r.choice_id,
                "text": r.text_value or "",
                "value": r.numeric_value,
            }

            # Coordinates + datetime + file (if the model fields exist).
            if hasattr(r, "x_value") and r.x_value is not None:
                out["x"] = r.x_value
            if hasattr(r, "y_value") and r.y_value is not None:
                out["y"] = r.y_value
            if hasattr(r, "datetime_value") and r.datetime_value is not None:
                if qtype == "date":
                    out["text"] = r.datetime_value.date().isoformat()
                elif qtype == "time":
                    out["text"] = r.datetime_value.time().isoformat(timespec="minutes")
                else:
                    out["text"] = r.datetime_value.isoformat(timespec="minutes")
            if hasattr(r, "file_value"):
                try:
                    if r.file_value and r.file_value.name:
                        out["file_url"] = r.file_value.url
                except (ValueError, AttributeError):
                    pass

            return out

        from games.models import GameAnswer

        a = (
            GameAnswer.objects
            .filter(session=session, question=current_q, participant_id=uid)
            .order_by("-id")
            .first()
        )

        if not a:
            return None

        return {
            "choice_id": a.choice_id,
            "is_correct": a.is_correct,
            "points": a.points_awarded,
            "was_late": getattr(a, "was_late", False),
            "puzzle_order": a.puzzle_order or [],
        }

    def _sync_tally(self, session, question_id):
        from polls.models import Response as PollResp
        from games.models import GameAnswer

        if session.kind == "poll":
            counts = {}
            texts = []

            for r in PollResp.objects.filter(session=session, question_id=question_id):
                if r.choice_id:
                    key = str(r.choice_id)
                    counts[key] = counts.get(key, 0) + 1
                elif r.numeric_value is not None:
                    key = self._numeric_bucket_key(r.numeric_value)
                    if key is not None:
                        counts[key] = counts.get(key, 0) + 1

                if r.text_value:
                    texts.append(r.text_value)

            return {
                "counts": counts,
                "texts": texts,
            }

        return self._game_tally_payload(session, question_id)

    def _game_tally_payload(self, session, question_id):
        """Build live game tally data.

        Classic and picture-choice questions return normal choice counts.
        Puzzle questions return the first correct participant as `winner`,
        because the presenter view should show the winner/avatar instead of
        a bar chart.
        """
        from games.models import GameAnswer, GameQuestion

        q = GameQuestion.objects.filter(pk=question_id).first()

        if q and getattr(q, "question_type", "mcq") == "puzzle":
            winner = (
                GameAnswer.objects
                .filter(session=session, question_id=question_id, is_correct=True)
                .order_by("created_at", "id")
                .first()
            )
            return {
                "counts": {},
                "texts": [],
                "winner": {
                    "nickname": winner.nickname,
                    "avatar_id": winner.avatar_id,
                    "points": winner.points_awarded,
                } if winner else None,
            }

        counts = {}
        for a in GameAnswer.objects.filter(session=session, question_id=question_id):
            if a.choice_id:
                key = str(a.choice_id)
                counts[key] = counts.get(key, 0) + 1

        return {"counts": counts, "texts": []}

    @database_sync_to_async
    def _record_answer(
        self,
        session_pk,
        uid,
        question_id,
        choice_id,
        text,
        value,
        puzzle_order,
        client_received_at,
        choice_ids=None,
        ordered_ids=None,
        matrix=None,
        points=None,
        x=None,
        y=None,
        datetime_kind=None,
        file_payload=None,
    ):
        from django.db import transaction
        from polls.models import Question as PollQ
        from polls.models import Choice as PollC
        from polls.models import Response as PollResp
        from games.models import GameQuestion, GameChoice, GameAnswer

        session = LiveSession.objects.get(pk=session_pk)

        # ───────── POLL path ─────────
        if session.kind == "poll":
            try:
                q = PollQ.objects.get(
                    pk=question_id,
                    questionnaire=session.questionnaire,
                )
            except PollQ.DoesNotExist:
                return {"kind": "poll", "ok": False}

            qtype = q.type

            # Single choice (and reaction).
            choice = None
            if choice_id not in (None, "", "null", "undefined"):
                choice = PollC.objects.filter(pk=choice_id, question=q).first()

            clean_text = str(text or "").strip()
            clean_value = None
            if value not in (None, "", "null", "undefined"):
                try:
                    clean_value = float(value)
                except Exception:
                    clean_value = None

            # Scale-family fallback: numeric typed as text.
            if qtype in ("scale", "rating", "nps", "slider", "numeric") and clean_value is None and clean_text:
                try:
                    clean_value = float(clean_text)
                except Exception:
                    clean_value = None

            # Coordinates (pin_image / pin_map / two_by_two).
            clean_x = None
            clean_y = None
            if x not in (None, "", "null", "undefined"):
                try: clean_x = float(x)
                except Exception: clean_x = None
            if y not in (None, "", "null", "undefined"):
                try: clean_y = float(y)
                except Exception: clean_y = None

            # Date / time / datetime → DateTimeField.
            clean_dt = None
            if qtype in ("date", "datetime", "time") and clean_text:
                from django.utils.dateparse import (
                    parse_date, parse_time, parse_datetime,
                )
                import datetime as _dt
                try:
                    if qtype == "date":
                        d = parse_date(clean_text)
                        if d:
                            clean_dt = _dt.datetime.combine(d, _dt.time(0, 0))
                    elif qtype == "time":
                        t = parse_time(clean_text)
                        if t:
                            clean_dt = _dt.datetime.combine(_dt.date(1970, 1, 1), t)
                    else:  # "datetime"
                        # Browser <input type="datetime-local"> produces "2025-01-15T14:30"
                        dt = parse_datetime(clean_text) or parse_datetime(clean_text + ":00")
                        if dt:
                            clean_dt = dt
                except Exception:
                    clean_dt = None

            # ── Ranking: multi-row, one per ranked choice, weight encodes rank.
            if qtype == "ranking" and isinstance(ordered_ids, list) and ordered_ids:
                valid_choices = list(PollC.objects.filter(question=q, pk__in=ordered_ids))
                by_id = {c.id: c for c in valid_choices}
                ordered = [by_id[int(cid)] for cid in ordered_ids if int(cid) in by_id]
                with transaction.atomic():
                    PollResp.objects.filter(
                        question=q, session=session, participant_id=uid,
                    ).delete()
                    n = len(ordered)
                    for rank_idx, c in enumerate(ordered):
                        PollResp.objects.create(
                            question=q, session=session, participant_id=uid,
                            choice=c,
                            numeric_value=float(n - rank_idx),  # higher = better rank
                        )
                return {
                    "kind": "poll", "ok": True, "question_type": qtype,
                }

            # ── Multi-choice MCQ / image_choice / likert (with max>1).
            if qtype in ("mcq", "image_choice") and isinstance(choice_ids, list) and choice_ids:
                valid_choices = list(PollC.objects.filter(question=q, pk__in=choice_ids))
                with transaction.atomic():
                    PollResp.objects.filter(
                        question=q, session=session, participant_id=uid,
                    ).delete()
                    for c in valid_choices:
                        PollResp.objects.create(
                            question=q, session=session, participant_id=uid,
                            choice=c,
                        )
                return {
                    "kind": "poll", "ok": True, "question_type": qtype,
                    "choice_id": valid_choices[0].id if valid_choices else None,
                }

            # ── Matrix: one MatrixAnswer per row.
            if qtype == "matrix" and isinstance(matrix, dict) and matrix:
                try:
                    from polls.models import MatrixAnswer, MatrixRow
                except Exception:
                    MatrixAnswer = None
                if MatrixAnswer is not None:
                    valid_rows = {r.id: r for r in MatrixRow.objects.filter(question=q)}
                    with transaction.atomic():
                        MatrixAnswer.objects.filter(
                            question=q, session=session, participant_id=uid,
                        ).delete()
                        for row_id_str, raw in matrix.items():
                            try:
                                row_id = int(row_id_str)
                                num = float(raw)
                            except Exception:
                                continue
                            row = valid_rows.get(row_id)
                            if not row:
                                continue
                            MatrixAnswer.objects.create(
                                question=q, matrix_row=row, session=session,
                                participant_id=uid, numeric_value=num,
                            )
                    return {"kind": "poll", "ok": True, "question_type": qtype}

            # ── Points allocation: one row per (choice, value).
            if qtype == "points_allocation" and isinstance(points, dict) and points:
                try:
                    from polls.models import PointsAllocation
                except Exception:
                    PointsAllocation = None
                if PointsAllocation is not None:
                    cfg = q.config or {}
                    total = int(cfg.get("total", cfg.get("points_total", 100)))
                    valid_choices = {c.id: c for c in PollC.objects.filter(question=q)}
                    clean_points = {}
                    spent = 0
                    for cid_str, raw in points.items():
                        try:
                            cid = int(cid_str)
                            pts = int(raw)
                        except Exception:
                            continue
                        if pts < 0:
                            pts = 0
                        if cid in valid_choices:
                            clean_points[cid] = pts
                            spent += pts
                    if spent != total:
                        return {
                            "kind": "poll", "ok": False,
                            "error": f"Points must sum to {total} (got {spent}).",
                        }
                    with transaction.atomic():
                        PointsAllocation.objects.filter(
                            question=q, session=session, participant_id=uid,
                        ).delete()
                        for cid, pts in clean_points.items():
                            PointsAllocation.objects.create(
                                question=q, choice=valid_choices[cid],
                                session=session, participant_id=uid,
                                points=pts,
                            )
                    return {"kind": "poll", "ok": True, "question_type": qtype}

            # ── File upload: decode data-URL and save to FileField.
            saved_file = None
            if qtype == "file_upload" and isinstance(file_payload, dict):
                data_url = file_payload.get("data_url") or ""
                filename = (file_payload.get("filename") or "upload.bin")[:120]
                if data_url.startswith("data:"):
                    import base64
                    from django.core.files.base import ContentFile
                    try:
                        header, b64 = data_url.split(",", 1)
                        raw = base64.b64decode(b64)
                        saved_file = ContentFile(raw, name=filename)
                    except Exception:
                        saved_file = None

            # ── Default single-row path (mcq single, yes_no, likert single,
            #     scale, rating, nps, slider, numeric, open, word, reaction,
            #     pin_image, pin_map, two_by_two, date/time/datetime, file).
            with transaction.atomic():
                existing_qs = (
                    PollResp.objects
                    .select_for_update()
                    .filter(
                        question=q,
                        session=session,
                        participant_id=uid,
                    )
                    .order_by("-id")
                )

                response = existing_qs.first()

                if response is None:
                    response = PollResp(
                        question=q,
                        session=session,
                        participant_id=uid,
                    )
                else:
                    existing_qs.exclude(pk=response.pk).delete()

                response.choice = choice
                response.text_value = clean_text
                response.numeric_value = clean_value
                # Optional fields (only assign if the model has them).
                if hasattr(response, "x_value"):        response.x_value = clean_x
                if hasattr(response, "y_value"):        response.y_value = clean_y
                if hasattr(response, "datetime_value"): response.datetime_value = clean_dt
                if saved_file is not None and hasattr(response, "file_value"):
                    response.file_value = saved_file
                response.save()

            return {
                "kind": "poll",
                "ok": True,
                "question_type": qtype,
                "choice_id": choice.id if choice else None,
                "choice_text": choice.text if choice else clean_text,
                "text": clean_text,
            }

        # ───────── GAME path ─────────
        try:
            q = GameQuestion.objects.get(pk=question_id, quiz=session.quiz)
        except GameQuestion.DoesNotExist:
            return {"kind": "game", "ok": False}

        prior = (
            GameAnswer.objects
            .filter(session=session, question=q, participant_id=uid)
            .order_by("-id")
            .first()
        )

        if prior:
            participant = Participant.objects.filter(
                session=session,
                participant_uid=uid,
            ).first()
            return {
                "kind": "game",
                "ok": True,
                "question_type": getattr(q, "question_type", "mcq"),
                "puzzle_order": prior.puzzle_order or [],
                "is_correct": prior.is_correct,
                "points": prior.points_awarded,
                "score": participant.score if participant else 0,
                "was_late": getattr(prior, "was_late", False),
            }

        # ── Synchronized deadline check ──
        # Compute "seconds since the server started this question".
        deadline_passed = False
        seconds_since_start = 0

        if session.question_started_at:
            now = timezone.now()
            seconds_since_start = (now - session.question_started_at).total_seconds()
            total_allowed = (q.time_limit or 0) + int(session.time_extension_seconds or 0)
            # Small fudge so a packet that left the phone a hair after the
            # deadline isn't rejected by clock skew.
            deadline_passed = seconds_since_start > (total_allowed + 0.75)

        allow_late = bool(getattr(session.quiz, "allow_late_answers", False))
        late_pct = int(getattr(session.quiz, "late_answer_points_pct", 0) or 0)
        late_pct = max(0, min(100, late_pct))

        if deadline_passed and not allow_late:
            return {
                "kind": "game",
                "ok": False,
                "rejected_reason": "deadline",
            }

        # ── Decide correctness ──
        question_type = getattr(q, "question_type", "mcq") or "mcq"

        is_correct = False
        choice = None
        submitted_puzzle_order = []

        if question_type == "puzzle":
            # The participant sent puzzle_order = [choice_id, choice_id, ...]
            # in the order they arranged the pieces. Compare against the
            # correct ordering defined by correct_position on each piece.
            try:
                submitted_puzzle_order = [
                    int(x) for x in (puzzle_order or [])
                    if str(x).strip().lstrip("-").isdigit()
                ]
            except Exception:
                submitted_puzzle_order = []

            correct_order = list(
                q.choices.filter(correct_position__gt=0)
                .order_by("correct_position", "id")
                .values_list("id", flat=True)
            )
            is_correct = bool(correct_order) and submitted_puzzle_order == correct_order

        else:
            # mcq + picture_choice both use choice_id selection.
            if choice_id not in (None, "", "null", "undefined"):
                choice = GameChoice.objects.filter(pk=choice_id, question=q).first()
            is_correct = bool(choice and choice.is_correct)

        # ── Compute time taken (capped to the legitimate window) ──
        time_taken_ms = 0
        if client_received_at:
            try:
                time_taken_ms = max(
                    0,
                    int((time.time() * 1000) - int(client_received_at)),
                )
            except Exception:
                time_taken_ms = 0

        if session.question_started_at:
            # Use server-measured elapsed instead of client clock when we
            # have a real start — protects against rigged client timestamps.
            time_taken_ms = max(0, int(seconds_since_start * 1000))

        # ── Compute points ──
        points = 0
        was_late = bool(deadline_passed)

        if is_correct:
            limit_ms = max(1, (q.time_limit or 1) * 1000)
            if session.quiz.scoring == "speed":
                effective_ms = min(time_taken_ms, limit_ms) if not was_late else limit_ms
                speed_factor = max(0.25, 1.0 - (effective_ms / limit_ms))
                points = int(q.points * speed_factor)
            else:
                points = q.points

            if was_late:
                points = int(points * (late_pct / 100.0))

        # ── Persist participant score + answer row ──
        participant, _ = Participant.objects.get_or_create(
            session=session,
            participant_uid=uid,
            defaults={
                "nickname": "Guest",
                "avatar_id": "dragon",
            },
        )

        participant.score = (participant.score or 0) + points
        participant.save(update_fields=["score"])

        GameAnswer.objects.create(
            question=q,
            session=session,
            participant_id=uid,
            nickname=participant.nickname,
            avatar_id=participant.avatar_id,
            choice=choice,
            puzzle_order=submitted_puzzle_order,
            is_correct=is_correct,
            time_taken_ms=time_taken_ms,
            points_awarded=points,
            was_late=was_late,
            room_id=participant.room_id,
        )

        return {
            "kind": "game",
            "ok": True,
            "question_type": question_type,
            "puzzle_order": submitted_puzzle_order,
            "is_correct": is_correct,
            "points": points,
            "score": participant.score,
            "was_late": was_late,
        }

    @database_sync_to_async
    def _tally(self, session_pk, question_id):
        from polls.models import Response as PollResp
        from games.models import GameAnswer

        session = LiveSession.objects.get(pk=session_pk)

        if not question_id:
            return {}

        if session.kind == "poll":
            counts = {}
            texts = []

            for r in PollResp.objects.filter(session=session, question_id=question_id):
                if r.choice_id:
                    key = str(r.choice_id)
                    counts[key] = counts.get(key, 0) + 1
                elif r.numeric_value is not None:
                    key = self._numeric_bucket_key(r.numeric_value)
                    if key is not None:
                        counts[key] = counts.get(key, 0) + 1

                if r.text_value:
                    texts.append(r.text_value)

            return {
                "counts": counts,
                "texts": texts,
            }

        return self._game_tally_payload(session, question_id)

    @database_sync_to_async
    def _leaderboard(self, session_pk):
        session = LiveSession.objects.get(pk=session_pk)

        if session.kind == "game" and session.quiz and session.quiz.use_rooms:
            from collections import defaultdict
            from games.models import GameRoom

            room_meta = {
                r.slug: {"name": r.name, "avatar_id": r.avatar_id}
                for r in GameRoom.objects.filter(quiz=session.quiz)
            }

            buckets = defaultdict(list)

            for p in session.participants.all():
                buckets[p.room_id or "—"].append(p.score)

            rows = []
            for rid, scores in buckets.items():
                meta = room_meta.get(rid, {})
                rows.append({
                    "slug": rid,
                    "name": meta.get("name") or rid or "—",
                    "avatar_id": meta.get("avatar_id") or "dragon",
                    "score": round(sum(scores) / len(scores), 1),
                    "members": len(scores),
                })

            rows.sort(key=lambda r: r["score"], reverse=True)

            return {
                "mode": "rooms",
                "rows": rows,
            }

        rows = [
            {
                "name": p.nickname,
                "avatar_id": p.avatar_id,
                "score": p.score,
            }
            for p in session.participants.order_by("-score", "id")[:50]
        ]

        return {
            "mode": "individuals",
            "rows": rows,
        }