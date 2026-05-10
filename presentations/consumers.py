"""
SessionConsumer — single WebSocket consumer that handles BOTH presenter and
participant roles in BOTH polls and games. Role is determined by the first
message ("hello").

Message types (client → server):
    hello           {role: "presenter"|"participant", uid, nickname?, avatar_id?}
    advance         (presenter only) — move to next question (orchestra)
    back            (presenter only) — previous question (orchestra)
    goto            (presenter only) — jump to specific question index
    end             (presenter only) — end the session
    answer          {question_id, choice_id?, text?, value?} (participant)
    self_advance    (participant) — open mode, advance own pointer
    draw            (presenter) — drawing event broadcast {ev, x, y, color, size}
    clear_draw      (presenter) — clear overlay
    group_display   (presenter) — toggle all-charts-on-one-screen
    fullscreen      (presenter) — request fullscreen sync

Message types (server → clients):
    state           full session state snapshot
    question        question payload — render this
    tally           live answer tally for the current question
    leaderboard     game leaderboard update
    draw            drawing event to mirror on viewer screens
    ended           session ended
    error           {detail}
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

        # send a fresh state snapshot
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
            nickname = (msg.get("nickname") or "Guest").strip()[:40]
            avatar_id = msg.get("avatar_id", "dragon")
            await self._register_participant(self.session_pk, self.uid, nickname, avatar_id)
            # let everyone refresh the leaderboard/lobby count
            await self._broadcast_state()

        session = await self._get_session(self.code)
        await self.send_json(await self._state_payload(session))

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
            # acknowledge to the participant
            await self.send_json({
                "type": "answer_ack",
                "is_correct": result.get("is_correct"),
                "points": result.get("points"),
                "score": result.get("score"),
            })
            # broadcast updated leaderboard
            lb = await self._leaderboard(self.session_pk)
            await self.channel_layer.group_send(self.group, {"type": "broadcast",
                "payload": {"type": "leaderboard", "data": lb}})
        # broadcast a fresh tally
        tally = await self._tally(self.session_pk, msg.get("question_id"))
        await self.channel_layer.group_send(self.group, {"type": "broadcast",
            "payload": {"type": "tally", "question_id": msg.get("question_id"), "data": tally}})

    async def _on_self_advance(self, msg):
        # in open mode, participants just track their own index client-side;
        # this is a no-op on the server but acknowledged for completeness.
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
        await self.send_json(event["payload"])

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
    def _register_participant(self, session_pk, uid, nickname, avatar_id):
        session = LiveSession.objects.get(pk=session_pk)
        # rooms logic for games
        room_id = ""
        if session.kind == "game" and session.quiz and session.quiz.use_rooms:
            cap = session.quiz.room_capacity
            # find a room with space, else create new
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
            # only forward-out-of-lobby is meaningful
            if delta > 0:
                session.state = "running"
                session.current_question_index = 0
                session.save(update_fields=["state", "current_question_index"])
            return session
        # running:
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
    def _state_payload(self, session):
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
                }
            else:
                question_data = {
                    "id": current.id,
                    "text": current.text,
                    "time_limit": current.time_limit,
                    "points": current.points,
                    "choices": [{"id": c.id, "text": c.text} for c in current.choices.all()],
                }
        return {
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
        }

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
        choice = GameChoice.objects.filter(pk=choice_id, question=q).first() if choice_id else None
        is_correct = bool(choice and choice.is_correct)

        # speed-based scoring: faster = more points, decaying linearly
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
            counts = {}
            texts = []
            for r in PollResp.objects.filter(session=session, question_id=question_id):
                if r.choice_id:
                    counts[str(r.choice_id)] = counts.get(str(r.choice_id), 0) + 1
                if r.text_value:
                    texts.append(r.text_value)
            return {"counts": counts, "texts": texts}
        # game
        counts = {}
        for a in GameAnswer.objects.filter(session=session, question_id=question_id):
            if a.choice_id:
                counts[str(a.choice_id)] = counts.get(str(a.choice_id), 0) + 1
        return {"counts": counts}

    @database_sync_to_async
    def _leaderboard(self, session_pk):
        session = LiveSession.objects.get(pk=session_pk)
        if session.kind == "game" and session.quiz and session.quiz.use_rooms:
            # average score per room
            from collections import defaultdict
            buckets = defaultdict(list)
            for p in session.participants.all():
                buckets[p.room_id or "—"].append(p.score)
            rows = [{"name": rid, "score": round(sum(s) / len(s), 1)} for rid, s in buckets.items()]
            rows.sort(key=lambda r: r["score"], reverse=True)
            return {"mode": "rooms", "rows": rows}
        rows = [
            {"name": p.nickname, "avatar_id": p.avatar_id, "score": p.score}
            for p in session.participants.all()[:50]
        ]
        return {"mode": "individuals", "rows": rows}
