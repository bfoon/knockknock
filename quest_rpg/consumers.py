import json

from asgiref.sync import sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer
from django.db import IntegrityError
from django.utils import timezone

from .models import QuestQuestion, QuestResponse, QuestSession, QuestTeam


class QuestConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.code = self.scope["url_route"]["kwargs"]["code"].upper()
        self.group = f"quest_{self.code}"
        self.is_host = False
        self.team_id = None
        self.session = await self._get_session()
        if not self.session:
            await self.close()
            return
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()
        await self.send_json({"type": "state", "session": await self._snapshot()})

    async def disconnect(self, code):
        if getattr(self, "group", None):
            await self.channel_layer.group_discard(self.group, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        try:
            data = json.loads(text_data or "{}")
        except (TypeError, ValueError):
            return
        mtype = data.get("type")
        if mtype == "host_hello":
            self.is_host = True
            await self.send_json({"type": "state", "session": await self._snapshot()})
        elif mtype == "team_join":
            await self._handle_team_join(data)
        elif mtype == "answer":
            await self._handle_answer(data)
        elif mtype == "start" and self.is_host:
            await self._set_status(QuestSession.STATUS_LIVE)
            await self._broadcast_state("start")
        elif mtype == "goto" and self.is_host:
            await self._handle_goto(data)
        elif mtype == "reveal" and self.is_host:
            await self._broadcast({"type": "reveal", "question_index": await self._current_question()})
        elif mtype == "end" and self.is_host:
            await self._set_status(QuestSession.STATUS_ENDED)
            await self._broadcast_state("end")

    async def _handle_team_join(self, data):
        name = (data.get("name") or "").strip()[:80] or "Team Adventurers"
        avatar = (data.get("avatar") or "explorer").strip()[:30]
        team = await self._get_or_create_team(name, avatar)
        self.team_id = team["id"]
        await self.send_json({"type": "team_joined", "team": team, "session": await self._snapshot()})
        await self._broadcast_state("team_joined")

    async def _handle_answer(self, data):
        team_id = self.team_id or data.get("team_id")
        selected = (data.get("selected") or "").strip().upper()[:1]
        if selected not in {"A", "B", "C", "D"} or not team_id:
            return
        result = await self._record_answer(int(team_id), selected)
        await self.send_json({"type": "answer_result", **result, "session": await self._snapshot()})
        await self._broadcast_state("answer_update")

    async def _handle_goto(self, data):
        try:
            index = int(data.get("index"))
        except (TypeError, ValueError):
            return
        await self._set_current_question(index)
        await self._broadcast({"type": "goto", "index": await self._current_question(), "session": await self._snapshot()})

    async def _broadcast_state(self, reason):
        await self._broadcast({"type": "state", "reason": reason, "session": await self._snapshot()})

    async def _broadcast(self, payload):
        await self.channel_layer.group_send(self.group, {"type": "fanout", "payload": payload})

    async def fanout(self, event):
        await self.send_json(event["payload"])

    async def send_json(self, obj):
        await self.send(text_data=json.dumps(obj))

    @sync_to_async
    def _get_session(self):
        return QuestSession.objects.filter(code=self.code).first()

    @sync_to_async
    def _snapshot(self):
        session = QuestSession.objects.prefetch_related("questions", "teams").get(code=self.code)
        data = session.as_dict()
        current = min(session.current_question, max(0, len(data["questions"]) - 1)) if data["questions"] else 0
        data["current_question"] = current
        data["responses"] = list(QuestResponse.objects.filter(question__session=session).values(
            "team_id", "question_id", "selected_option", "is_correct", "points_awarded"
        ))
        return data

    @sync_to_async
    def _get_or_create_team(self, name, avatar):
        session = QuestSession.objects.get(code=self.code)
        try:
            team, created = QuestTeam.objects.get_or_create(
                session=session,
                name=name,
                defaults={"avatar": avatar or "explorer", "last_seen_at": timezone.now()},
            )
        except IntegrityError:
            team = QuestTeam.objects.get(session=session, name=name)
        if team.avatar != avatar and avatar:
            team.avatar = avatar
        team.last_seen_at = timezone.now()
        team.save(update_fields=["avatar", "last_seen_at"])
        return team.as_dict()

    @sync_to_async
    def _record_answer(self, team_id, selected):
        session = QuestSession.objects.get(code=self.code)
        question = QuestQuestion.objects.filter(session=session, position=session.current_question).first()
        if not question:
            return {"ok": False, "message": "No active question."}
        team = QuestTeam.objects.get(id=team_id, session=session)
        existing = QuestResponse.objects.filter(team=team, question=question).first()
        if existing:
            return {
                "ok": True,
                "already_answered": True,
                "correct": existing.is_correct,
                "points_awarded": existing.points_awarded,
                "correct_option": question.correct_option,
                "explanation": question.explanation,
            }
        correct = selected == question.correct_option
        points = question.points if correct else 0
        QuestResponse.objects.create(
            team=team,
            question=question,
            selected_option=selected,
            is_correct=correct,
            points_awarded=points,
        )
        if correct:
            team.points += points
            team.correct_count += 1
            team.progress = max(team.progress, session.current_question + 1)
        else:
            team.wrong_count += 1
        team.last_seen_at = timezone.now()
        team.save(update_fields=["points", "correct_count", "wrong_count", "progress", "last_seen_at"])
        return {
            "ok": True,
            "already_answered": False,
            "correct": correct,
            "points_awarded": points,
            "correct_option": question.correct_option,
            "explanation": question.explanation,
            "treasure_hint": question.treasure_hint,
            "danger_text": question.danger_text,
        }

    @sync_to_async
    def _set_current_question(self, index):
        session = QuestSession.objects.get(code=self.code)
        total = session.questions.count()
        if total:
            index = max(0, min(index, total - 1))
        else:
            index = 0
        session.current_question = index
        session.save(update_fields=["current_question"])

    @sync_to_async
    def _current_question(self):
        return QuestSession.objects.get(code=self.code).current_question

    @sync_to_async
    def _set_status(self, status):
        QuestSession.objects.filter(code=self.code).update(status=status)
