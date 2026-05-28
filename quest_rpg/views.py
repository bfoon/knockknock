import json

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.db import IntegrityError
from django.http import JsonResponse, HttpResponseBadRequest
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.http import require_GET, require_POST

from .models import QuestQuestion, QuestResponse, QuestSession, QuestTeam


def _join_url(request, session):
    """Absolute fallback join URL. The presenter page also rebuilds this
    client-side from location.origin + join_path, which prevents QR codes from
    accidentally using localhost, an internal proxy host, or the wrong scheme.
    """
    return request.build_absolute_uri(reverse("quest_rpg:join", args=[session.code]))


def _join_path(session):
    return reverse("quest_rpg:join", args=[session.code])


def _session_snapshot(session_or_code, include_answers=False):
    if isinstance(session_or_code, QuestSession):
        code = session_or_code.code
    else:
        code = str(session_or_code).upper()
    session = QuestSession.objects.prefetch_related("questions", "teams").get(code=code)
    data = session.as_dict(include_answers=include_answers)
    data["current_question"] = min(
        session.current_question,
        max(0, len(data.get("questions", [])) - 1),
    ) if data.get("questions") else 0
    # selected_option is safe to send because the public/team snapshot still does
    # not include correct_option unless include_answers=True. It lets each team
    # review the wrong trails they tried without revealing the answer key.
    response_fields = [
        "team_id", "question_id", "selected_option", "is_correct",
        "points_awarded", "wrong_choices", "answered_at",
    ]
    data["responses"] = list(
        QuestResponse.objects.filter(question__session=session).values(*response_fields)
    )
    return data


def _broadcast_session(session, reason="state", extra=None):
    """Push an updated snapshot to projector and phones.

    Start/end/next/reveal now work even when the presenter button is clicked
    before the WebSocket host handshake finishes because the HTTP endpoint also
    broadcasts through Channels.
    """
    payload = {"type": "state", "reason": reason, "session": _session_snapshot(session)}
    if extra:
        payload.update(extra)
    channel_layer = get_channel_layer()
    if channel_layer:
        async_to_sync(channel_layer.group_send)(
            f"quest_{session.code}",
            {"type": "fanout", "payload": payload},
        )
    return payload


def _broadcast_payload(session, payload):
    channel_layer = get_channel_layer()
    if channel_layer:
        async_to_sync(channel_layer.group_send)(
            f"quest_{session.code}",
            {"type": "fanout", "payload": payload},
        )


def _default_questions():
    return [
        {
            "prompt": "Your team reaches a locked jungle gate. Which action opens the first door?",
            "option_a": "Team discussion before answering",
            "option_b": "One person guessing quickly",
            "option_c": "Ignoring the question",
            "option_d": "Waiting until time ends",
            "correct_option": "A",
            "points": 100,
            "treasure_hint": "The gate glows when the team agrees.",
            "danger_text": "The vines shake and slow your path.",
            "explanation": "Quest mode rewards teams that discuss and choose together.",
        },
        {
            "prompt": "A glowing bridge appears over the river. What moves your team closer to the treasure?",
            "option_a": "More wrong answers",
            "option_b": "Correct answers and teamwork",
            "option_c": "Leaving the team screen",
            "option_d": "Changing the team name",
            "correct_option": "B",
            "points": 120,
            "treasure_hint": "Every correct answer lights one stone on the bridge.",
            "danger_text": "The bridge cracks and your team loses momentum.",
            "explanation": "Correct answers add points and progress on the map.",
        },
        {
            "prompt": "The treasure chest asks: what will prove your team led the adventure?",
            "option_a": "Only team names",
            "option_b": "The host password",
            "option_c": "Team avatars, points, and correct answers",
            "option_d": "Nothing until the game is deleted",
            "correct_option": "C",
            "points": 150,
            "treasure_hint": "The chest opens for the strongest team performance.",
            "danger_text": "The chest stays locked for now.",
            "explanation": "The presenter screen shows live team rankings with avatars.",
        },
    ]


def _seed_questions(session):
    if session.questions.exists():
        return
    QuestQuestion.objects.bulk_create([
        QuestQuestion(session=session, position=i, **q)
        for i, q in enumerate(_default_questions())
    ])


def _get_or_create_team(session, name, avatar):
    name = (name or "").strip()[:80] or "Team Adventurers"
    avatar = (avatar or "explorer").strip()[:30] or "explorer"
    try:
        team, _ = QuestTeam.objects.get_or_create(
            session=session,
            name=name,
            defaults={"avatar": avatar, "last_seen_at": timezone.now()},
        )
    except IntegrityError:
        team = QuestTeam.objects.get(session=session, name=name)
    changed = []
    if avatar and team.avatar != avatar:
        team.avatar = avatar
        changed.append("avatar")
    team.last_seen_at = timezone.now()
    changed.append("last_seen_at")
    team.save(update_fields=changed)
    return team


def _team_active_question(session, team):
    """Return the next unanswered challenge for this team.

    Adventure mode is self-paced: the session no longer decides which
    question everyone is on. Each team's ``progress`` stores how many
    stages it has completed, so the next active question is position=progress.
    """
    total = session.questions.count()
    if total <= 0:
        return None, 0, True
    if team.progress >= total:
        return None, total, True
    question = QuestQuestion.objects.filter(session=session, position=team.progress).first()
    return question, total, False


def _record_answer(session, team_id, selected):
    selected = (selected or "").strip().upper()[:1]
    if selected not in {"A", "B", "C", "D"}:
        return {"ok": False, "message": "Choose A, B, C, or D."}
    if session.status == QuestSession.STATUS_ENDED:
        return {"ok": False, "message": "This quest has ended."}
    if session.status != QuestSession.STATUS_LIVE:
        return {"ok": False, "message": "The adventure is not open yet. Ask the owner to press Open Adventure."}

    team = QuestTeam.objects.get(id=int(team_id), session=session)
    question, total, complete = _team_active_question(session, team)
    if complete:
        return {
            "ok": True,
            "complete": True,
            "message": "Your team already reached the treasure.",
            "next_position": total,
            "completed_at": team.completed_at.isoformat() if team.completed_at else "",
        }
    if not question:
        return {"ok": False, "message": "No active challenge."}

    previous = QuestResponse.objects.filter(team=team, question=question).first()
    if previous and previous.is_correct:
        return {
            "ok": True,
            "already_answered": True,
            "correct": True,
            "points_awarded": 0,
            "correct_option": question.correct_option if session.show_correct_after_answer else "",
            "explanation": question.explanation if session.show_correct_after_answer else "",
            "treasure_hint": question.treasure_hint,
            "danger_text": question.danger_text,
            "wrong_choices": previous.wrong_choices or [],
            "next_position": team.progress,
            "complete": team.progress >= total,
            "completed_at": team.completed_at.isoformat() if team.completed_at else "",
        }

    now = timezone.now()
    correct = selected == question.correct_option
    points = question.points if correct else 0
    wrong_choices = list(previous.wrong_choices or []) if previous else []

    if not correct:
        wrong_choices.append({
            "option": selected,
            "at": now.isoformat(),
        })

    if previous:
        previous.selected_option = selected
        previous.is_correct = correct
        previous.points_awarded = points
        previous.wrong_choices = wrong_choices
        previous.save(update_fields=["selected_option", "is_correct", "points_awarded", "wrong_choices"])
    else:
        QuestResponse.objects.create(
            team=team,
            question=question,
            selected_option=selected,
            is_correct=correct,
            points_awarded=points,
            wrong_choices=wrong_choices,
        )

    update_fields = ["points", "correct_count", "wrong_count", "progress", "completed_at", "last_seen_at"]
    if correct:
        team.points += points
        team.correct_count += 1
        team.progress = max(team.progress, question.position + 1)
        if team.progress >= total and not team.completed_at:
            # Leaderboard winner order is based on who reached the treasure first.
            team.completed_at = now
    else:
        # Wrong answers do not move the team. They can try the same stage again.
        team.wrong_count += 1
    team.last_seen_at = now
    team.save(update_fields=update_fields)

    return {
        "ok": True,
        "already_answered": False,
        "correct": correct,
        "points_awarded": points,
        "correct_option": question.correct_option if (correct or session.show_correct_after_answer) else "",
        "explanation": question.explanation if (correct or session.show_correct_after_answer) else "",
        "treasure_hint": question.treasure_hint,
        "danger_text": question.danger_text,
        "wrong_choices": wrong_choices,
        "stage_position": question.position,
        "next_position": team.progress,
        "complete": team.progress >= total,
        "completed_at": team.completed_at.isoformat() if team.completed_at else "",
    }

@login_required
def session_list(request):
    sessions = QuestSession.objects.filter(owner=request.user).order_by("-updated_at")
    return render(request, "quest_rpg/session_list.html", {"sessions": sessions})


@login_required
def session_create(request):
    if request.method == "POST":
        title = (request.POST.get("title") or "Untitled Quest").strip()[:160]
        world = request.POST.get("world") or QuestSession.WORLD_JUNGLE
        try:
            team_size = int(request.POST.get("team_size") or 4)
        except ValueError:
            team_size = 4
        session = QuestSession.objects.create(
            owner=request.user,
            title=title or "Untitled Quest",
            world=world,
            team_size=max(0, team_size),
        )
        _seed_questions(session)
        return redirect("quest_rpg:edit", code=session.code)
    return render(request, "quest_rpg/session_create.html", {"worlds": QuestSession.WORLD_CHOICES})


@login_required
def session_edit(request, code):
    session = get_object_or_404(QuestSession, code=code.upper(), owner=request.user)
    _seed_questions(session)
    return render(request, "quest_rpg/session_edit.html", {
        "session": session,
        "session_json": json.dumps(session.as_dict(include_answers=True)),
        "present_url": request.build_absolute_uri(reverse("quest_rpg:present", args=[session.code])),
        "worlds": QuestSession.WORLD_CHOICES,
    })


@login_required
@require_POST
def session_save(request, code):
    session = get_object_or_404(QuestSession, code=code.upper(), owner=request.user)
    try:
        payload = json.loads(request.body or "{}")
    except (TypeError, ValueError):
        return HttpResponseBadRequest("Invalid JSON")

    session.title = (payload.get("title") or session.title)[:160]
    session.world = payload.get("world") or session.world
    try:
        session.team_size = max(0, int(payload.get("team_size", session.team_size)))
    except (TypeError, ValueError):
        pass
    session.show_correct_after_answer = bool(payload.get("show_correct_after_answer", session.show_correct_after_answer))
    session.save()

    questions = payload.get("questions")
    if isinstance(questions, list):
        session.questions.all().delete()
        rows = []
        for i, q in enumerate(questions):
            if not isinstance(q, dict) or not (q.get("prompt") or "").strip():
                continue
            options = q.get("options") or []
            opt = {"A": "", "B": "", "C": "", "D": ""}
            for item in options:
                if isinstance(item, dict) and item.get("key") in opt:
                    opt[item["key"]] = str(item.get("text") or "")[:500]
            rows.append(QuestQuestion(
                session=session,
                position=i,
                prompt=str(q.get("prompt") or "")[:2500],
                option_a=opt["A"], option_b=opt["B"], option_c=opt["C"], option_d=opt["D"],
                correct_option=(str(q.get("correct_option") or "A")[:1].upper() or "A"),
                points=max(0, int(q.get("points") or 100)),
                treasure_hint=str(q.get("treasure_hint") or "")[:240],
                danger_text=str(q.get("danger_text") or "")[:240],
                explanation=str(q.get("explanation") or "")[:2500],
            ))
        QuestQuestion.objects.bulk_create(rows)

    return JsonResponse({"ok": True, "session": session.as_dict(include_answers=True)})


@login_required
def session_present(request, code):
    session = get_object_or_404(QuestSession, code=code.upper(), owner=request.user)
    _seed_questions(session)
    # Do not auto-start here. The presenter controls when the quest is live.
    return render(request, "quest_rpg/session_present.html", {
        "session": session,
        "session_json": json.dumps(_session_snapshot(session)),
        "join_url": _join_url(request, session),
        "join_path": _join_path(session),
        "edit_url": reverse("quest_rpg:edit", args=[session.code]),
        "state_url": reverse("quest_rpg:state", args=[session.code]),
        "start_url": reverse("quest_rpg:start", args=[session.code]),
        "goto_url": reverse("quest_rpg:goto", args=[session.code]),
        "reveal_url": reverse("quest_rpg:reveal", args=[session.code]),
        "end_url": reverse("quest_rpg:end", args=[session.code]),
        "csrf_token": get_token(request),
    })


def session_join(request, code):
    session = get_object_or_404(QuestSession, code=code.upper())
    _seed_questions(session)
    return render(request, "quest_rpg/session_join.html", {
        "session": session,
        "session_json": json.dumps(_session_snapshot(session)),
        "state_url": reverse("quest_rpg:state", args=[session.code]),
        "team_url": reverse("quest_rpg:team_join", args=[session.code]),
        "answer_url": reverse("quest_rpg:answer", args=[session.code]),
        "csrf_token": get_token(request),
    })


@require_GET
def session_state(request, code):
    session = get_object_or_404(QuestSession, code=code.upper())
    return JsonResponse({"ok": True, "session": _session_snapshot(session)})


@login_required
@require_POST
def session_start(request, code):
    session = get_object_or_404(QuestSession, code=code.upper(), owner=request.user)
    _seed_questions(session)
    was_live = session.status == QuestSession.STATUS_LIVE
    session.status = QuestSession.STATUS_LIVE
    if not was_live:
        session.started_at = timezone.now()
    session.save(update_fields=["status", "started_at"])
    payload = _broadcast_session(session, "start")
    return JsonResponse({"ok": True, **payload})


@login_required
@require_POST
def session_goto(request, code):
    session = get_object_or_404(QuestSession, code=code.upper(), owner=request.user)
    try:
        payload = json.loads(request.body or "{}")
    except (TypeError, ValueError):
        payload = {}
    try:
        index = int(payload.get("index", session.current_question))
    except (TypeError, ValueError):
        index = session.current_question
    total = session.questions.count()
    index = max(0, min(index, total - 1)) if total else 0
    session.current_question = index
    session.save(update_fields=["current_question"])
    data = _broadcast_session(session, "goto", {"index": index})
    return JsonResponse({"ok": True, **data})


@login_required
@require_POST
def session_reveal(request, code):
    session = get_object_or_404(QuestSession, code=code.upper(), owner=request.user)
    payload = {"type": "reveal", "question_index": session.current_question, "session": _session_snapshot(session)}
    _broadcast_payload(session, payload)
    return JsonResponse({"ok": True, **payload})


@login_required
@require_POST
def session_reset_scores(request, code):
    session = get_object_or_404(QuestSession, code=code.upper(), owner=request.user)
    QuestTeam.objects.filter(session=session).update(
        points=0, correct_count=0, wrong_count=0, progress=0, completed_at=None
    )
    QuestResponse.objects.filter(question__session=session).delete()
    session.current_question = 0
    session.status = QuestSession.STATUS_DRAFT
    session.started_at = None
    session.save(update_fields=["current_question", "status", "started_at"])
    messages.success(request, "Quest scores reset.")
    _broadcast_session(session, "reset")
    return redirect("quest_rpg:edit", code=session.code)


@login_required
@require_POST
def session_delete(request, code):
    session = get_object_or_404(QuestSession, code=code.upper(), owner=request.user)
    session.delete()
    messages.success(request, "Quest deleted.")
    return redirect("quest_rpg:list")


@login_required
@require_POST
def session_end(request, code):
    session = get_object_or_404(QuestSession, code=code.upper(), owner=request.user)
    session.status = QuestSession.STATUS_ENDED
    session.save(update_fields=["status"])
    payload = _broadcast_session(session, "end")
    return JsonResponse({"ok": True, **payload})


@require_POST
def session_team_join(request, code):
    session = get_object_or_404(QuestSession, code=code.upper())
    try:
        payload = json.loads(request.body or "{}")
    except (TypeError, ValueError):
        payload = {}
    team = _get_or_create_team(session, payload.get("name"), payload.get("avatar"))
    broadcast = _broadcast_session(session, "team_joined")
    return JsonResponse({"ok": True, "team": team.as_dict(), "session": broadcast["session"]})


@require_POST
def session_answer(request, code):
    session = get_object_or_404(QuestSession, code=code.upper())
    try:
        payload = json.loads(request.body or "{}")
    except (TypeError, ValueError):
        payload = {}
    team_id = payload.get("team_id")
    if not team_id:
        return JsonResponse({"ok": False, "message": "Team not found."}, status=400)
    result = _record_answer(session, team_id, payload.get("selected"))
    broadcast = _broadcast_session(session, "answer_update")
    return JsonResponse({**result, "session": broadcast["session"]})
