"""
kura/chat.py — thread resolution and message fanout for survey chat.

Three kinds of room, all keyed so get-or-create can never duplicate them:

    survey        the working group: owner + collaborators + supervisors
    team:<id>     one field team: owner + its supervisor + its members
    direct:<a>:<b>  two people (the owner↔supervisor line)

Broadcasting follows kura/live.py's rule: it is a bonus. If Channels
isn't installed, the layer isn't configured, or Redis is down, the
message is still saved and the page falls back to polling
/chat/<id>/messages/?after=<id>.
"""

from __future__ import annotations

from django.db.models import Q

from .models_team import (
    ChatMessage,
    ChatRead,
    ChatThread,
    SurveyCollaborator,
    TeamConfig,
    TeamMember,
)

MAX_BODY = 4000


# ─────────────────────────────────────────────────────────────────────
# Groups and fanout
# ─────────────────────────────────────────────────────────────────────

def thread_group(thread_id) -> str:
    return f"kura_chat_{thread_id}"


def _fanout(thread_id, payload) -> None:
    try:
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        layer = get_channel_layer()
        if layer is None:
            return
        async_to_sync(layer.group_send)(
            thread_group(thread_id), {"type": "chat.event", "payload": payload},
        )
    except Exception:
        pass


# ─────────────────────────────────────────────────────────────────────
# Threads
# ─────────────────────────────────────────────────────────────────────

def _ensure(survey, key, kind, title="", team=None, participants=()):
    thread, created = ChatThread.objects.get_or_create(
        survey=survey, key=key,
        defaults={"kind": kind, "title": title[:120], "team": team},
    )
    if created and participants:
        thread.participants.set([u for u in participants if u is not None])
    elif not created and not thread.title and title:
        thread.title = title[:120]
        thread.save(update_fields=["title"])
    return thread


def survey_thread(survey) -> ChatThread:
    return _ensure(survey, "survey", "survey", title=f"{survey.title} · team")


def team_thread(team) -> ChatThread:
    return _ensure(
        team.survey, f"team:{team.id}", "team",
        title=team.name, team=team,
    )


def direct_thread(survey, user_a, user_b) -> ChatThread:
    a, b = sorted([user_a.id, user_b.id])
    name_a = user_a.get_full_name() or user_a.get_username()
    name_b = user_b.get_full_name() or user_b.get_username()
    return _ensure(
        survey, f"direct:{a}:{b}", "direct",
        title=f"{name_a} & {name_b}",
        participants=[user_a, user_b],
    )


def can_access(user, thread) -> bool:
    """Whether a signed-in user may read and post in a thread."""
    if not user or not getattr(user, "is_authenticated", False):
        return False

    survey = thread.survey
    if survey.owner_id == user.id:
        return True

    if thread.kind == "direct":
        return thread.participants.filter(id=user.id).exists()

    if thread.kind == "team":
        if not thread.team_id:
            return False
        if thread.team.supervisor_id == user.id:
            return True
        return TeamMember.objects.filter(
            team_id=thread.team_id, user=user, is_active=True).exists()

    # Survey room: collaborators and supervisors, not rank-and-file
    # enumerators (they have their team room).
    if SurveyCollaborator.objects.filter(survey=survey, user=user).exists():
        return True
    return survey.teams.filter(supervisor_id=user.id).exists()


def threads_for(user, survey) -> list:
    """Every thread this user may open on this survey, newest first.

    The rooms they should have are created on demand here, so a
    supervisor who has never chatted still sees their team room and a
    direct line to the owner.
    """
    if not getattr(user, "is_authenticated", False):
        return []
    if not TeamConfig.for_survey(survey).chat_enabled:
        return []

    is_owner = survey.owner_id == user.id
    supervised = list(survey.teams.filter(supervisor_id=user.id, is_active=True))
    membership = TeamMember.objects.filter(
        survey=survey, user=user, is_active=True).select_related("team").first()
    is_collab = SurveyCollaborator.objects.filter(
        survey=survey, user=user).exists()

    threads = []

    if is_owner or is_collab or supervised:
        threads.append(survey_thread(survey))

    if is_owner:
        for team in survey.teams.filter(is_active=True):
            threads.append(team_thread(team))
            if team.supervisor_id and team.supervisor_id != user.id:
                threads.append(direct_thread(survey, user, team.supervisor))
    else:
        for team in supervised:
            threads.append(team_thread(team))
        if membership:
            threads.append(team_thread(membership.team))
        # A supervisor always gets a direct line to the owner.
        if supervised and survey.owner_id:
            threads.append(direct_thread(survey, user, survey.owner))

    # Any direct thread they are already in (e.g. owner ↔ collaborator).
    existing = ChatThread.objects.filter(
        survey=survey, kind="direct", participants=user)
    threads.extend(existing)

    seen, unique = set(), []
    for t in threads:
        if t.id not in seen:
            seen.add(t.id)
            unique.append(t)
    unique.sort(key=lambda t: t.updated_at, reverse=True)
    return unique


# ─────────────────────────────────────────────────────────────────────
# Messages
# ─────────────────────────────────────────────────────────────────────

def post(thread, author, body, kind="text", context=None) -> ChatMessage:
    msg = ChatMessage.objects.create(
        thread=thread,
        author=author,
        kind=kind,
        body=(body or "")[:MAX_BODY],
        context=context or {},
    )
    ChatThread.objects.filter(id=thread.id).update(
        updated_at=msg.created_at)
    _fanout(thread.id, {"type": "message", "message": msg.as_dict()})
    if author is not None:
        mark_read(thread, author, msg.id)
    return msg


def post_system(thread, body, context=None) -> ChatMessage:
    return post(thread, None, body, kind="system", context=context)


def post_issue(thread, author, issue, body="") -> ChatMessage:
    """A message that points at a data issue, so the member can tap
    straight through to the row that needs fixing."""
    text = body or (
        f"Please check {issue.field or 'this response'}: {issue.detail}"
    )
    return post(thread, author, text, kind="issue", context={
        "issue_id": issue.id,
        "submission_id": issue.submission_id,
        "field": issue.field,
    })


def messages(thread, after_id=0, limit=200) -> list:
    qs = thread.messages.select_related("author")
    if after_id:
        qs = qs.filter(id__gt=int(after_id))
        return [m.as_dict() for m in qs.order_by("id")[:limit]]
    rows = list(qs.order_by("-id")[:limit])
    rows.reverse()
    return [m.as_dict() for m in rows]


def mark_read(thread, user, up_to_id=None) -> int:
    if up_to_id is None:
        last = thread.messages.order_by("-id").first()
        up_to_id = last.id if last else 0
    read, created = ChatRead.objects.get_or_create(
        thread=thread, user=user, defaults={"last_read_id": up_to_id})
    if not created and up_to_id > read.last_read_id:
        read.last_read_id = up_to_id
        read.save(update_fields=["last_read_id", "updated_at"])
    return up_to_id


def unread_count(thread, user) -> int:
    read = ChatRead.objects.filter(thread=thread, user=user).first()
    last_read = read.last_read_id if read else 0
    return thread.messages.filter(id__gt=last_read).exclude(author=user).count()


def unread_map(user, survey) -> dict:
    """{thread_id: unread} across every thread the user can see."""
    out = {}
    reads = dict(
        ChatRead.objects.filter(user=user, thread__survey=survey)
        .values_list("thread_id", "last_read_id")
    )
    for thread in ChatThread.objects.filter(survey=survey):
        last_read = reads.get(thread.id, 0)
        out[thread.id] = thread.messages.filter(
            id__gt=last_read).exclude(author=user).count()
    return out


def notify_participants(thread, exclude_user=None):
    """User ids that should see a badge for this thread."""
    survey = thread.survey
    ids = set()
    if survey.owner_id:
        ids.add(survey.owner_id)
    if thread.kind == "direct":
        ids = set(thread.participants.values_list("id", flat=True))
    elif thread.kind == "team" and thread.team_id:
        if thread.team.supervisor_id:
            ids.add(thread.team.supervisor_id)
        ids.update(TeamMember.objects.filter(
            team_id=thread.team_id, is_active=True).values_list("user_id", flat=True))
    else:
        ids.update(SurveyCollaborator.objects.filter(survey=survey)
                   .values_list("user_id", flat=True))
        ids.update(survey.teams.filter(supervisor__isnull=False)
                   .values_list("supervisor_id", flat=True))
    if exclude_user is not None:
        ids.discard(getattr(exclude_user, "id", exclude_user))
    return ids


def resolve_thread(survey, thread_id, user):
    """Fetch a thread the user is allowed to open, or None."""
    thread = ChatThread.objects.filter(
        Q(id=thread_id), survey=survey).select_related("team", "survey").first()
    if thread is None or not can_access(user, thread):
        return None
    return thread
