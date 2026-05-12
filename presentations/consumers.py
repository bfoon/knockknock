"""
SessionConsumer — single WebSocket consumer that handles BOTH presenter and
participant roles in BOTH polls and games.

Poll answers are permanently auto-saved into polls.Response.
The live chart still updates immediately through WebSocket tally broadcasts.
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
            client_received_at=msg.get("question_received_at"),
        )

        if result.get("kind") == "game":
            await self.send_json({
                "type": "answer_ack",
                "question_id": msg.get("question_id"),
                "choice_id": msg.get("choice_id"),
                "is_correct": result.get("is_correct"),
                "points": result.get("points"),
                "score": result.get("score"),
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
        await self.send_json({"type": "self_advance_ack"})

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
        """Participant tapped a specific room's door.

        We attempt to seat them. Three outcomes are signalled back:
          - granted: they're now in this room (door swings open client-side)
          - denied_full: room is at capacity
          - denied_no_such_room: room slug doesn't exist for this quiz
        Either way, an updated rooms snapshot is broadcast so other
        participants see the new occupancy in real time.
        """
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
            # Tell everyone the door count moved.
            await self._broadcast_rooms_update()

    async def broadcast(self, event):
        payload = event["payload"]

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
        """Push the current rooms-with-occupancy snapshot to everyone."""
        rooms = await self._rooms_snapshot(self.session_pk)
        if rooms is None:
            return  # Quiz isn't using rooms.

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
        """Persist (or refresh) a participant.

        Room policy:
          - If the quiz uses rooms AND has named rooms defined, the
            participant DOES NOT get auto-routed. They have to pick a
            door via room_join_request. Their room_id stays blank until
            they do — the UI uses that as the "show room picker" signal.
          - If the quiz uses rooms but has no named rooms defined, we
            keep the legacy auto-fill behaviour for back-compat.
          - If the participant already has a room, preserve it.
          - If they ARE rejoining with a requested room slug and it's
            valid + not full, seat them in it.
        """
        from games.models import GameRoom

        session = LiveSession.objects.get(pk=session_pk)

        existing = Participant.objects.filter(
            session=session,
            participant_uid=uid,
        ).first()

        # Decide the room slug.
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
            # Keep them where they were (they came back into the same browser).
            # If their room was deleted by the presenter, clear it.
            if not named_rooms or any(r.slug == existing.room_id for r in named_rooms):
                room_id = existing.room_id

        elif uses_rooms and named_rooms and requested_room:
            # New-style: participant explicitly requested a door.
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
            # Legacy auto-fill: fill earliest non-full bucket.
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
        """Atomically try to put this participant in the named room.

        Returns {"ok": bool, "reason": str, "room": {...}|None}.
        """
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

            # Already in this room? Just confirm.
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
        """Return [{slug, name, avatar_id, capacity, occupancy, is_full}, ...]
        for the session's quiz. Returns None when the quiz isn't using rooms
        OR has no named rooms defined."""
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

        # From lobby: Next starts the first question.
        if session.state == "lobby":
            if delta > 0:
                session.state = "running"
                session.current_question_index = 0
                session.ended_at = None
                session.save(update_fields=["state", "current_question_index", "ended_at"])
            return session

        # From final/end screen: Back returns to the last question.
        if session.state == "ended":
            if delta < 0:
                session.state = "running"
                session.current_question_index = max(0, total - 1)
                session.ended_at = None
                session.save(update_fields=["state", "current_question_index", "ended_at"])
            return session

        current_idx = max(0, min(total - 1, session.current_question_index))

        # Pressing Next on the last question now opens the celebratory The End page.
        if delta > 0 and current_idx >= total - 1:
            session.state = "ended"
            session.current_question_index = current_idx
            session.ended_at = timezone.now()
            session.save(update_fields=["state", "current_question_index", "ended_at"])
            return session

        session.current_question_index = max(
            0,
            min(total - 1, current_idx + delta),
        )
        session.save(update_fields=["current_question_index"])

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
        session.save(update_fields=["state", "current_question_index"])

        return session

    @database_sync_to_async
    def _end_session(self, session_pk):
        LiveSession.objects.filter(pk=session_pk).update(
            state="ended",
            ended_at=timezone.now(),
        )


    def _scale_bounds_for(self, question):
        """Return safe integer scale bounds for scale-style poll questions."""
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

        # Do not send stale A/B choices for free-text or non-choice question types.
        # This protects questions that were created as MCQ and later changed to Open Text.
        try:
            if hasattr(question, "has_choices") and not question.has_choices():
                return []
        except Exception:
            pass

        if q_type in {
            "open", "word", "numeric", "rating", "nps", "slider",
            "date", "time", "datetime", "file", "pin_image", "pin_map", "two_by_two",
        }:
            return []

        return [
            {"id": c.id, "text": c.text}
            for c in question.choices.all()
        ]

    def _numeric_bucket_key(self, value):
        try:
            number = float(value)
        except Exception:
            return None
        if number.is_integer():
            return str(int(number))
        return str(number)

    @database_sync_to_async
    def _state_payload(self, session, uid=None, role=None):
        questions = session.questions()
        idx = session.current_question_index
        current = questions[idx] if 0 <= idx < len(questions) else None

        question_data = None

        if current:
            if session.kind == "poll":
                question_data = {
                    "id": current.id,
                    "text": current.text,
                    "type": current.type,
                    "chart_type": current.chart_type,
                    "choices": self._poll_choices_payload(current),
                    "config": getattr(current, "config", {}) or {},
                    "scale_min": self._scale_bounds_for(current)[0],
                    "scale_max": self._scale_bounds_for(current)[1],
                    "font_family": getattr(current, "font_family", "clash"),
                    "font_size": getattr(current, "font_size", 44),
                    "font_bold": getattr(current, "font_bold", True),
                }
            else:
                question_data = {
                    "id": current.id,
                    "text": current.text,
                    "time_limit": current.time_limit,
                    "points": current.points,
                    "choices": [
                        {"id": c.id, "text": c.text}
                        for c in current.choices.all()
                    ],
                    "font_family": getattr(current, "font_family", "clash"),
                    "font_size": getattr(current, "font_size", 32),
                    "font_bold": getattr(current, "font_bold", True),
                }

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
            "question": question_data,
            "participants": session.participants.count(),
            "chart_background": getattr(
                getattr(session, "quiz", None),
                "chart_background",
                "normal",
            ),
        }

        # Rooms snapshot — included whenever a game uses rooms and has
        # named rooms defined. The client uses this to render the door
        # picker and to update occupancy in real time.
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
            payload["tally"] = self._sync_tally(session, current.id)

        return payload

    def _my_answer_for(self, session, current_q, uid):
        if session.kind == "poll":
            from polls.models import Response as PollResp

            r = (
                PollResp.objects
                .filter(session=session, question=current_q, participant_id=uid)
                .order_by("-id")
                .first()
            )

            if not r:
                return None

            return {
                "choice_id": r.choice_id,
                "text": r.text_value or "",
                "value": r.numeric_value,
            }

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

        counts = {}

        for a in GameAnswer.objects.filter(session=session, question_id=question_id):
            if a.choice_id:
                key = str(a.choice_id)
                counts[key] = counts.get(key, 0) + 1

        return {"counts": counts}

    @database_sync_to_async
    def _record_answer(
        self,
        session_pk,
        uid,
        question_id,
        choice_id,
        text,
        value,
        client_received_at,
    ):
        from django.db import transaction
        from polls.models import Question as PollQ
        from polls.models import Choice as PollC
        from polls.models import Response as PollResp
        from games.models import GameQuestion, GameChoice, GameAnswer

        session = LiveSession.objects.get(pk=session_pk)

        if session.kind == "poll":
            try:
                q = PollQ.objects.get(
                    pk=question_id,
                    questionnaire=session.questionnaire,
                )
            except PollQ.DoesNotExist:
                return {
                    "kind": "poll",
                    "ok": False,
                }

            choice = None

            if choice_id not in (None, "", "null", "undefined"):
                choice = PollC.objects.filter(
                    pk=choice_id,
                    question=q,
                ).first()

            clean_text = str(text or "").strip()

            clean_value = None

            if value not in (None, "", "null", "undefined"):
                try:
                    clean_value = float(value)
                except Exception:
                    clean_value = None

            if q.type in ("scale", "rating", "nps", "slider", "numeric") and clean_value is None and clean_text:
                try:
                    clean_value = float(clean_text)
                except Exception:
                    clean_value = None

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
                response.save()

            return {
                "kind": "poll",
                "ok": True,
                "question_type": q.type,
                "choice_id": choice.id if choice else None,
                "choice_text": choice.text if choice else clean_text,
                "text": clean_text,
            }

        try:
            q = GameQuestion.objects.get(
                pk=question_id,
                quiz=session.quiz,
            )
        except GameQuestion.DoesNotExist:
            return {
                "kind": "game",
                "ok": False,
            }

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
                "is_correct": prior.is_correct,
                "points": prior.points_awarded,
                "score": participant.score if participant else 0,
            }

        choice = None

        if choice_id not in (None, "", "null", "undefined"):
            choice = GameChoice.objects.filter(
                pk=choice_id,
                question=q,
            ).first()

        is_correct = bool(choice and choice.is_correct)

        time_taken_ms = 0

        if client_received_at:
            try:
                time_taken_ms = max(
                    0,
                    int((time.time() * 1000) - int(client_received_at)),
                )
            except Exception:
                time_taken_ms = 0

        points = 0

        if is_correct:
            if session.quiz.scoring == "speed":
                limit_ms = q.time_limit * 1000
                speed_factor = max(0.25, 1.0 - (time_taken_ms / max(1, limit_ms)))
                points = int(q.points * speed_factor)
            else:
                points = q.points

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
            is_correct=is_correct,
            time_taken_ms=time_taken_ms,
            points_awarded=points,
            room_id=participant.room_id,
        )

        return {
            "kind": "game",
            "ok": True,
            "is_correct": is_correct,
            "points": points,
            "score": participant.score,
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

        counts = {}

        for a in GameAnswer.objects.filter(session=session, question_id=question_id):
            if a.choice_id:
                key = str(a.choice_id)
                counts[key] = counts.get(key, 0) + 1

        return {"counts": counts}

    @database_sync_to_async
    def _leaderboard(self, session_pk):
        session = LiveSession.objects.get(pk=session_pk)

        if session.kind == "game" and session.quiz and session.quiz.use_rooms:
            from collections import defaultdict
            from games.models import GameRoom

            # Map slug → (name, avatar_id) for named rooms; legacy auto-
            # filled slugs ("room-1" etc.) won't be in this map and fall
            # back to displaying the slug as-is.
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