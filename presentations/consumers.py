"""
SessionConsumer — single WebSocket consumer that handles BOTH presenter and
participant roles in BOTH polls and games. Role is determined by the first
message ("hello").

REFRESH-RESILIENCE
------------------
On every `state` payload sent to a participant we include:
  - `my_answer`   — the participant's previous answer for the current question
                    ({choice_id, is_correct, points} for games | {choice_id, text, value} for polls | None)
  - `my_score`    — the participant's running score (games)
  - `my_nickname` / `my_avatar` / `my_room` — what the server has for them
  - `tally`       — the current question's live tally (so charts can re-render)

This way, when a participant reloads the page, they reconnect with the same
`uid` (persisted in localStorage), the server recognizes them, and the client
can restore the locked-in tile + chart without ever showing the nickname picker
again.
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

        # Generic state snapshot (no uid yet — we don't know who they are).
        await self.send_json(await self._state_payload(session))

    async def disconnect(self, code):
        if hasattr(self, "group"):
            await self.channel_layer.group_discard(self.group, self.channel_name)

    # ─────────────────────────── inbound ────────────────────────────

    async def receive_json(self, content, **kwargs):
        t = content.get("type")
        handler = {
            "hello":          self._on_hello,
            "advance":        self._on_advance,
            "back":           self._on_back,
            "goto":           self._on_goto,
            "end":            self._on_end,
            "answer":         self._on_answer,
            "self_advance":   self._on_self_advance,
            "draw":           self._on_draw,
            "clear_draw":     self._on_clear_draw,
            "group_display":  self._on_group_display,
            "fullscreen":     self._on_fullscreen,
            "ping":           self._on_ping,
        }.get(t)
        if not handler:
            await self.send_json({"type": "error", "detail": f"unknown type {t}"})
            return
        await handler(content)

    async def _on_hello(self, msg):
        self.role = msg.get("role", "participant")
        self.uid = msg.get("uid") or str(uuid.uuid4())

        if self.role == "participant":
            # If the participant already exists for this session+uid, REUSE their
            # nickname & avatar (refresh case). Otherwise create with what the
            # client sent.
            existing = await self._get_participant(self.session_pk, self.uid)
            if existing:
                nickname  = (msg.get("nickname") or existing["nickname"] or "Guest").strip()[:40]
                avatar_id = msg.get("avatar_id") or existing["avatar_id"] or "dragon"
            else:
                nickname  = (msg.get("nickname") or "Guest").strip()[:40]
                avatar_id = msg.get("avatar_id") or "dragon"
            await self._register_participant(self.session_pk, self.uid, nickname, avatar_id)
            # let everyone refresh the leaderboard/lobby count
            await self._broadcast_state()
            # Push a leaderboard tick so the presenter sees the (possibly new) row
            session = await self._get_session(self.code)
            if session and session.kind == "game":
                lb = await self._leaderboard(self.session_pk)
                await self.channel_layer.group_send(
                    self.group,
                    {"type": "broadcast", "payload": {"type": "leaderboard", "data": lb}},
                )

        # Send a state snapshot personalised for this participant.
        session = await self._get_session(self.code)
        await self.send_json(await self._state_payload(session, uid=self.uid, role=self.role))

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
        await self.channel_layer.group_send(self.group, {"type": "broadcast", "payload": {"type": "ended"}})

    async def _on_answer(self, msg):
        if self.role != "participant":
            return
        result = await self._record_answer(
            self.session_pk, self.uid,
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
            await self.channel_layer.group_send(self.group, {"type": "broadcast",
                "payload": {"type": "leaderboard", "data": lb}})
        tally = await self._tally(self.session_pk, msg.get("question_id"))
        await self.channel_layer.group_send(self.group, {"type": "broadcast",
            "payload": {"type": "tally", "question_id": msg.get("question_id"), "data": tally}})

    async def _on_self_advance(self, msg):
        await self.send_json({"type": "self_advance_ack"})

    async def _on_draw(self, msg):
        if self.role != "presenter":
            return
        await self.channel_layer.group_send(self.group, {
            "type": "broadcast",
            "payload": {"type": "draw", "ev": msg.get("ev"), "x": msg.get("x"), "y": msg.get("y"),
                        "color": msg.get("color"), "size": msg.get("size"), "tool": msg.get("tool")},
        })

    async def _on_clear_draw(self, msg):
        if self.role != "presenter":
            return
        await self.channel_layer.group_send(self.group, {
            "type": "broadcast",
            "payload": {"type": "clear_draw"},
        })

    async def _on_group_display(self, msg):
        if self.role != "presenter":
            return
        await self.channel_layer.group_send(self.group, {
            "type": "broadcast",
            "payload": {"type": "group_display", "enabled": bool(msg.get("enabled"))},
        })

    async def _on_fullscreen(self, msg):
        if self.role != "presenter":
            return
        await self.channel_layer.group_send(self.group, {
            "type": "broadcast",
            "payload": {"type": "fullscreen"},
        })

    async def _on_ping(self, msg):
        await self.send_json({"type": "pong", "t": time.time()})

    # ─────────────────────────── broadcast helpers ───────────────────────

    async def broadcast(self, event):
        """Personalised delivery — if the payload is a `state` and we have a
        uid attached to this connection (participant), rebuild with their
        `my_*` fields so each participant sees their own progress.
        """
        payload = event["payload"]
        if payload.get("type") == "state" and self.role == "participant" and self.uid:
            session = await self._get_session(self.code)
            payload = await self._state_payload(session, uid=self.uid, role=self.role)
        await self.send_json(payload)

    async def _broadcast_state(self, session=None):
        if session is None:
            session = await self._get_session(self.code)
        payload = await self._state_payload(session)
        await self.channel_layer.group_send(self.group, {"type": "broadcast", "payload": payload})

    # ─────────────────────────── DB-bound (sync→async) ───────────────────

    @database_sync_to_async
    def _get_session(self, code):
        try:
            return (LiveSession.objects
                    .select_related("questionnaire", "quiz")
                    .get(code=code))
        except LiveSession.DoesNotExist:
            return None

    @database_sync_to_async
    def _get_participant(self, session_pk, uid):
        try:
            p = Participant.objects.get(session_id=session_pk, participant_uid=uid)
            return {
                "nickname": p.nickname,
                "avatar_id": p.avatar_id,
                "score": p.score or 0,
                "room_id": p.room_id or "",
            }
        except Participant.DoesNotExist:
            return None

    @database_sync_to_async
    def _register_participant(self, session_pk, uid, nickname, avatar_id):
        session = LiveSession.objects.get(pk=session_pk)
        existing = Participant.objects.filter(session=session, participant_uid=uid).first()
        if existing and existing.room_id:
            room_id = existing.room_id
        else:
            room_id = ""
            if session.kind == "game" and session.quiz and session.quiz.use_rooms:
                cap = session.quiz.room_capacity
                from collections import Counter
                occupancy = Counter(
                    Participant.objects.filter(session=session).exclude(room_id="").values_list("room_id", flat=True)
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
            session=session, participant_uid=uid,
            defaults={"nickname": nickname, "avatar_id": avatar_id, "room_id": room_id},
        )

    @database_sync_to_async
    def _advance(self, session_pk, delta):
        session = LiveSession.objects.select_related("questionnaire", "quiz").get(pk=session_pk)
        total = len(session.questions())
        if total == 0:
            return session
        if session.state == "lobby":
            if delta > 0:
                session.state = "running"
                session.current_question_index = 0
                session.save(update_fields=["state", "current_question_index"])
            return session
        session.current_question_index = max(0, min(total - 1, session.current_question_index + delta))
        session.save(update_fields=["current_question_index"])
        return session

    @database_sync_to_async
    def _goto(self, session_pk, idx):
        session = LiveSession.objects.select_related("questionnaire", "quiz").get(pk=session_pk)
        total = len(session.questions())
        session.state = "running" if total else "lobby"
        session.current_question_index = max(0, min(max(0, total - 1), idx))
        session.save(update_fields=["state", "current_question_index"])
        return session

    @database_sync_to_async
    def _end_session(self, session_pk):
        LiveSession.objects.filter(pk=session_pk).update(state="ended", ended_at=timezone.now())

    @database_sync_to_async
    def _state_payload(self, session, uid=None, role=None):
        """Build a state snapshot. If `uid` is given (participant), include
        their existing answer/score so the client can restore on refresh.
        Always include the current question's tally for chart restore.
        """
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
                    "choices": [{"id": c.id, "text": c.text} for c in current.choices.all()],
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
                    "choices": [{"id": c.id, "text": c.text} for c in current.choices.all()],
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
            "chart_background": getattr(getattr(session, "quiz", None), "chart_background", "normal"),
        }

        # Personalise for this participant
        if uid and role == "participant":
            try:
                me = Participant.objects.get(session=session, participant_uid=uid)
            except Participant.DoesNotExist:
                me = None
            if me:
                payload["my_nickname"] = me.nickname
                payload["my_avatar"]   = me.avatar_id
                payload["my_score"]    = me.score or 0
                payload["my_room"]     = me.room_id or ""
            if current and me:
                payload["my_answer"] = self._my_answer_for(session, current, uid)

        # Live tally for the current question (chart restore on reload)
        if current:
            payload["tally"] = self._sync_tally(session, current.id)

        return payload

    def _my_answer_for(self, session, current_q, uid):
        """This participant's existing answer for current_q (or None)."""
        if session.kind == "poll":
            from polls.models import Response as PollResp
            r = PollResp.objects.filter(
                session=session, question=current_q, participant_id=uid,
            ).first()
            if not r:
                return None
            return {
                "choice_id": r.choice_id,
                "text": r.text_value or "",
                "value": r.numeric_value,
            }
        from games.models import GameAnswer
        a = (GameAnswer.objects
             .filter(session=session, question=current_q, participant_id=uid)
             .order_by("-id").first())
        if not a:
            return None
        return {
            "choice_id": a.choice_id,
            "is_correct": a.is_correct,
            "points": a.points_awarded,
        }

    def _sync_tally(self, session, question_id):
        """Tally callable inside an existing DB-sync block."""
        from polls.models import Response as PollResp
        from games.models import GameAnswer
        if session.kind == "poll":
            counts, texts = {}, []
            for r in PollResp.objects.filter(session=session, question_id=question_id):
                if r.choice_id:
                    counts[str(r.choice_id)] = counts.get(str(r.choice_id), 0) + 1
                if r.text_value:
                    texts.append(r.text_value)
            return {"counts": counts, "texts": texts}
        counts = {}
        for a in GameAnswer.objects.filter(session=session, question_id=question_id):
            if a.choice_id:
                counts[str(a.choice_id)] = counts.get(str(a.choice_id), 0) + 1
        return {"counts": counts}

    @database_sync_to_async
    def _record_answer(self, session_pk, uid, question_id, choice_id, text, value, client_received_at):
        from polls.models import Question as PollQ, Choice as PollC, Response as PollResp
        from games.models import GameQuestion, GameChoice, GameAnswer
        session = LiveSession.objects.get(pk=session_pk)

        if session.kind == "poll":
            try:
                q = PollQ.objects.get(pk=question_id, questionnaire=session.questionnaire)
            except PollQ.DoesNotExist:
                return {"kind": "poll", "ok": False}
            choice = PollC.objects.filter(pk=choice_id, question=q).first() if choice_id else None
            PollResp.objects.update_or_create(
                question=q, session=session, participant_id=uid,
                defaults={"choice": choice, "text_value": text or "", "numeric_value": value},
            )
            return {"kind": "poll", "ok": True}

        # game side
        try:
            q = GameQuestion.objects.get(pk=question_id, quiz=session.quiz)
        except GameQuestion.DoesNotExist:
            return {"kind": "game", "ok": False}

        # Idempotent: if this participant already answered this question, return
        # the prior result. This guards against replayed messages / refreshes.
        prior = (GameAnswer.objects
                 .filter(session=session, question=q, participant_id=uid)
                 .order_by("-id").first())
        if prior:
            participant = Participant.objects.filter(session=session, participant_uid=uid).first()
            return {"kind": "game", "ok": True,
                    "is_correct": prior.is_correct,
                    "points": prior.points_awarded,
                    "score": (participant.score if participant else 0)}

        choice = GameChoice.objects.filter(pk=choice_id, question=q).first() if choice_id else None
        is_correct = bool(choice and choice.is_correct)

        time_taken_ms = 0
        if client_received_at:
            try:
                time_taken_ms = max(0, int((time.time() * 1000) - int(client_received_at)))
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
            session=session, participant_uid=uid,
            defaults={"nickname": "Guest", "avatar_id": "dragon"},
        )
        participant.score = (participant.score or 0) + points
        participant.save(update_fields=["score"])

        GameAnswer.objects.create(
            question=q, session=session, participant_id=uid,
            nickname=participant.nickname, avatar_id=participant.avatar_id,
            choice=choice, is_correct=is_correct,
            time_taken_ms=time_taken_ms, points_awarded=points,
            room_id=participant.room_id,
        )
        return {"kind": "game", "ok": True, "is_correct": is_correct,
                "points": points, "score": participant.score}

    @database_sync_to_async
    def _tally(self, session_pk, question_id):
        from polls.models import Response as PollResp
        from games.models import GameAnswer
        session = LiveSession.objects.get(pk=session_pk)
        if not question_id:
            return {}
        if session.kind == "poll":
            counts, texts = {}, []
            for r in PollResp.objects.filter(session=session, question_id=question_id):
                if r.choice_id:
                    counts[str(r.choice_id)] = counts.get(str(r.choice_id), 0) + 1
                if r.text_value:
                    texts.append(r.text_value)
            return {"counts": counts, "texts": texts}
        counts = {}
        for a in GameAnswer.objects.filter(session=session, question_id=question_id):
            if a.choice_id:
                counts[str(a.choice_id)] = counts.get(str(a.choice_id), 0) + 1
        return {"counts": counts}

    @database_sync_to_async
    def _leaderboard(self, session_pk):
        session = LiveSession.objects.get(pk=session_pk)
        if session.kind == "game" and session.quiz and session.quiz.use_rooms:
            from collections import defaultdict
            buckets = defaultdict(list)
            for p in session.participants.all():
                buckets[p.room_id or "—"].append(p.score)
            rows = [{"name": rid, "score": round(sum(s) / len(s), 1)} for rid, s in buckets.items()]
            rows.sort(key=lambda r: r["score"], reverse=True)
            return {"mode": "rooms", "rows": rows}
        rows = [
            {"name": p.nickname, "avatar_id": p.avatar_id, "score": p.score}
            for p in session.participants.order_by("-score", "id")[:50]
        ]
        return {"mode": "individuals", "rows": rows}