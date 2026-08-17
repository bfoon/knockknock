"""
kura/team_views.py — HTTP endpoints for team collection.

Grouped as:

    manage/      owner-only: teams, members, collaborators, invites,
                 validation checks, config
    join/        the tokenised invite link (supervisor or member)
    board/       the supervisor's view: stats, rows, map, charts
    issues/      raise, assign, progress, resolve
    signoff/     pre-flight snapshot, sign, return
    chat/        REST fallback and thread bootstrap for the WebSocket

Every view resolves permissions through kura.teams.get_access(), which
404s rather than 403s on a survey the caller has no standing on — same
posture as the existing _own() helper, so a survey code stays
unguessable.
"""

from __future__ import annotations

import csv
import json
from datetime import datetime, timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.decorators import login_required
from django.db.models import Q
from django.http import Http404, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, render
from django.utils import timezone
from django.utils.dateparse import parse_date
from django.middleware.csrf import get_token
from django.utils.html import escape
from django.views.decorators.http import require_GET, require_POST

from . import chat as chat_svc
from . import teams as svc
from .models import CleaningPipeline, CleaningRule, Submission, Survey
from .models_team import (
    DataIssue,
    DataSignoff,
    FieldTeam,
    SurveyCollaborator,
    SurveyInvite,
    TeamConfig,
    TeamMember,
    ValidationCheck,
)

User = get_user_model()


# ─────────────────────────────────────────────────────────────────────
# helpers
# ─────────────────────────────────────────────────────────────────────

def _body(request):
    try:
        data = json.loads(request.body.decode("utf-8") or "{}")
    except (ValueError, UnicodeDecodeError):
        return None
    return data if isinstance(data, dict) else None


def _bad(message, status=400, **extra):
    payload = {"ok": False, "error": message}
    payload.update(extra)
    return JsonResponse(payload, status=status)


def _find_user(handle):
    """Resolve a username or email to a user, case-insensitively."""
    handle = (handle or "").strip()
    if not handle:
        return None
    return (User.objects.filter(username__iexact=handle).first()
            or User.objects.filter(email__iexact=handle).first())


def _resolve_user(value):
    """Accept a numeric id, a username or an email — the board sends ids,
    the management screen sends what was typed."""
    if value in (None, ""):
        return None
    if isinstance(value, int) or (isinstance(value, str) and value.isdigit()):
        return User.objects.filter(id=int(value)).first()
    return _find_user(value)


def _int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _base_url(request):
    return f"{request.scheme}://{request.get_host()}"


def _window(request, cfg):
    """Resolve ?day=YYYY-MM-DD / ?from=&to= / ?range=all into datetimes.

    Returns (start_date, end_date, start_dt, end_dt) with dates None when
    the caller asked for everything.
    """
    if (request.GET.get("range") or "").lower() == "all":
        return None, None, None, None

    frm = parse_date(request.GET.get("from") or "")
    to = parse_date(request.GET.get("to") or "")
    if frm and to:
        start_date, end_date = (frm, to) if frm <= to else (to, frm)
    else:
        day = parse_date(request.GET.get("day") or "") or timezone.localdate()
        start_date, end_date = svc.period_bounds(cfg, day)

    start_dt, end_dt = svc.to_datetime_range(start_date, end_date)
    return start_date, end_date, start_dt, end_dt


def _page(title, heading, body_html, links=()):
    """A tiny self-contained page, so the invite flow works before the
    full templates land."""
    link_html = "".join(
        f'<a class="btn" href="{escape(url)}">{escape(label)}</a>'
        for label, url in links
    )
    return HttpResponse(f"""<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{escape(title)} · Kura</title><style>
*{{box-sizing:border-box}}body{{margin:0;min-height:100vh;display:grid;place-items:center;
padding:2rem;color:#f8fbff;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;
background:radial-gradient(900px 560px at 86% -8%,rgba(255,138,31,.2),transparent 60%),
radial-gradient(780px 520px at 5% 5%,rgba(139,92,246,.3),transparent 60%),
linear-gradient(135deg,#050616,#090b23 45%,#160a2c)}}
.card{{max-width:520px;width:100%;border:1px solid rgba(255,255,255,.12);border-radius:18px;
padding:1.8rem;background:linear-gradient(135deg,rgba(255,255,255,.09),rgba(255,255,255,.03))}}
h1{{margin:0 0 .8rem;font-size:1.3rem}}p{{color:#b9c2e7;line-height:1.6}}
.btn{{display:inline-block;margin:.9rem .5rem 0 0;border:1px solid rgba(255,255,255,.18);
border-radius:10px;padding:.6rem 1rem;color:#f8fbff;text-decoration:none;font-weight:700;
background:linear-gradient(135deg,rgba(255,255,255,.10),rgba(255,255,255,.04))}}
button.btn{{cursor:pointer;font:inherit;font-weight:700}}
</style></head><body><div class="card"><h1>{escape(heading)}</h1>{body_html}{link_html}
</div></body></html>""")


# ─────────────────────────────────────────────────────────────────────
# Pages
# ─────────────────────────────────────────────────────────────────────

@login_required
def teams_page(request, code):
    """Owner's team management screen."""
    survey, access = svc.get_access(request, code, "can_manage_team")
    cfg = TeamConfig.for_survey(survey)
    return render(request, "kura/teams.html", {
        "survey": survey,
        "config_json": json.dumps(cfg.as_dict()),
        "access_json": json.dumps(access.as_dict()),
        "base_url": _base_url(request),
    })


@login_required
def team_board(request, code, team_id):
    """The supervisor's board. Owners can open any team's board."""
    survey, access = svc.get_access(request, code)
    team = svc.team_for(access, team_id)
    if not (access.is_owner or team.supervisor_id == request.user.id):
        raise Http404
    return render(request, "kura/team_board.html", {
        "survey": survey,
        "team": team,
        "team_json": json.dumps(team.as_dict()),
        "access_json": json.dumps(access.as_dict()),
        "board_url": f"/kura/{survey.code}/team/{team.id}/board/data/",
    })


@login_required
def my_work(request, code):
    """An enumerator's own page: their submissions and their issues."""
    survey, access = svc.get_access(request, code)
    return render(request, "kura/my_work.html", {
        "survey": survey,
        "access_json": json.dumps(access.as_dict()),
    })


# ─────────────────────────────────────────────────────────────────────
# Invites
# ─────────────────────────────────────────────────────────────────────

@login_required
def join(request, code, token):
    """Accept a supervisor / member / collaborator invite.

    GET confirms (so a link preview cannot burn a single-use invite),
    POST accepts.
    """
    survey = get_object_or_404(Survey, code=code.upper())
    invite = SurveyInvite.objects.filter(
        survey=survey, token=token).select_related("team").first()

    if invite is None:
        return _page("Invitation", "That link is not valid",
                     "<p>The invitation could not be found. Ask the survey "
                     "owner to send a fresh link.</p>")
    if not invite.is_valid():
        return _page("Invitation", "This link can no longer be used",
                     f"<p>{escape(invite.invalid_reason())}</p>")

    role_label = dict(SurveyInvite.ROLE_CHOICES).get(invite.role, invite.role)
    where = f" on {escape(invite.team.name)}" if invite.team_id else ""

    if request.method != "POST":
        return _page(
            "Invitation", f"Join {escape(survey.title)}",
            f"<p>You have been invited as <b>{escape(role_label)}</b>{where}."
            f"</p><p>Signed in as <b>{escape(request.user.get_username())}</b>."
            f"</p><form method='post'>"
            f"<input type='hidden' name='csrfmiddlewaretoken' "
            f"value='{escape(get_token(request))}'>"
            f"<button class='btn' type='submit'>Accept invitation</button>"
            f"</form>",
        )

    user = request.user
    links = []

    if invite.role == "supervisor":
        if not invite.team_id:
            return _bad("This supervisor invite has no team attached.", 400)
        team = invite.team
        team.supervisor = user
        team.save(update_fields=["supervisor", "updated_at"])
        svc.grant_device_access(survey, user, decided_by=survey.owner)
        chat_svc.team_thread(team)
        if survey.owner_id and survey.owner_id != user.id:
            chat_svc.direct_thread(survey, user, survey.owner)
        links = [("Open the team board",
                  f"/kura/{survey.code}/team/{team.id}/board/")]
        heading = f"You now supervise {team.name}"

    elif invite.role == "member":
        if not invite.team_id:
            return _bad("This member invite has no team attached.", 400)
        svc.add_member(invite.team, user, invited_by=invite.created_by)
        chat_svc.team_thread(invite.team)
        links = [("Open my work", f"/kura/{survey.code}/my/")]
        heading = f"You joined {invite.team.name}"

    else:
        SurveyCollaborator.objects.update_or_create(
            survey=survey, user=user,
            defaults={"role": invite.role, "invited_by": invite.created_by},
        )
        links = [("Open the data workbench", f"/kura/{survey.code}/data/")]
        heading = f"You joined {survey.title} as {role_label}"

    invite.uses += 1
    invite.last_accepted_at = timezone.now()
    if invite.max_uses and invite.uses >= invite.max_uses:
        invite.is_active = False
    invite.save(update_fields=["uses", "last_accepted_at", "is_active"])

    return _page("Invitation accepted", heading,
                 f"<p>Survey: <b>{escape(survey.title)}</b> "
                 f"({escape(survey.code)}).</p>", links)


@login_required
@require_POST
def invite_create(request, code):
    survey, access = svc.get_access(request, code, "can_manage_team")
    data = _body(request) or request.POST

    role = (data.get("role") or "").strip()
    if role not in dict(SurveyInvite.ROLE_CHOICES):
        return _bad("Pick a valid role.")

    team = None
    if role in ("supervisor", "member"):
        team = get_object_or_404(
            FieldTeam, id=_int(data.get("team_id")), survey=survey)

    try:
        max_uses = max(0, int(data.get("max_uses", 1 if role != "member" else 0)))
    except (TypeError, ValueError):
        max_uses = 1

    expires_at = None
    try:
        days = int(data.get("expires_days") or 0)
        if days > 0:
            expires_at = timezone.now() + timedelta(days=days)
    except (TypeError, ValueError):
        pass

    invite = SurveyInvite.objects.create(
        survey=survey, team=team, role=role,
        label=str(data.get("label") or "")[:120],
        email=str(data.get("email") or "")[:254],
        max_uses=max_uses, expires_at=expires_at,
        created_by=request.user,
    )
    return JsonResponse({"ok": True,
                         "invite": invite.as_dict(_base_url(request))})


@login_required
@require_POST
def invite_revoke(request, code, invite_id):
    survey, access = svc.get_access(request, code, "can_manage_team")
    invite = get_object_or_404(SurveyInvite, id=invite_id, survey=survey)
    invite.is_active = False
    invite.save(update_fields=["is_active"])
    return JsonResponse({"ok": True})


# ─────────────────────────────────────────────────────────────────────
# Team management (owner)
# ─────────────────────────────────────────────────────────────────────

@login_required
@require_GET
def teams_bootstrap(request, code):
    """Everything the management screen needs in one call."""
    survey, access = svc.get_access(request, code)
    cfg = TeamConfig.for_survey(survey)
    base = _base_url(request)

    visible = survey.teams.all()
    if not access.can_view_all_data and not access.is_owner:
        visible = visible.filter(id__in=access.team_ids())

    teams = []
    for team in visible.select_related("supervisor").prefetch_related("members__user"):
        subs = team.submissions()
        teams.append(team.as_dict({
            "submissions": subs.count(),
            "flagged": subs.filter(flags__resolved=False).distinct().count(),
            "open_issues": DataIssue.objects.filter(
                team=team, status__in=DataIssue.OPEN_STATUSES).count(),
            "members": [m.as_dict() for m in team.members.all()],
        }))

    payload = {
        "ok": True,
        "survey": {"code": survey.code, "title": survey.title,
                   "state": survey.state},
        "access": access.as_dict(),
        "config": cfg.as_dict(),
        "teams": teams,
    }

    if access.can_manage_team:
        payload["collaborators"] = [
            c.as_dict() for c in survey.collaborators.select_related("user")]
        payload["invites"] = [
            i.as_dict(base) for i in survey.invites.select_related("team")[:50]]

    if access.is_owner or access.can_manage_validation:
        payload["rules"] = [
            {"id": r.id, "name": r.name, "kind": r.kind,
             "action": r.action, "enabled": r.enabled}
            for r in survey.cleaning_rules.all()
        ]
        payload["pipelines"] = [
            {"id": p.id, "name": p.name, "steps": p.steps.count(),
             "source": p.source}
            for p in survey.pipelines.all()
        ]

    payload["validation_checks"] = [
        c.as_dict() for c in survey.validation_checks.select_related(
            "rule", "pipeline")]
    last = survey.validation_runs.first()
    payload["last_validation"] = last.as_dict() if last else None
    return JsonResponse(payload)


@login_required
@require_POST
def config_save(request, code):
    survey, access = svc.get_access(request, code, "can_manage_team")
    cfg = TeamConfig.for_survey(survey)
    data = _body(request) or request.POST

    bools = [
        "team_collection", "require_signoff", "allow_signoff_with_issues",
        "supervisor_can_edit_answers", "supervisor_can_export",
        "supervisor_can_see_other_teams", "validation_enabled", "chat_enabled",
    ]
    for name in bools:
        if name in data:
            raw = data.get(name)
            setattr(cfg, name, raw in (True, "true", "True", "1", 1, "on"))

    period = data.get("signoff_period")
    if period in ("day", "week"):
        cfg.signoff_period = period

    raw_time = (data.get("validation_time") or "").strip()
    if raw_time:
        try:
            cfg.validation_time = datetime.strptime(raw_time, "%H:%M").time()
        except ValueError:
            return _bad("validation_time must look like 18:00.")

    cfg.save()
    if cfg.team_collection:
        chat_svc.survey_thread(survey)
    return JsonResponse({"ok": True, "config": cfg.as_dict()})


@login_required
@require_POST
def team_create(request, code):
    survey, access = svc.get_access(request, code, "can_manage_team")
    data = _body(request) or request.POST
    name = str(data.get("name") or "").strip()[:80]
    if not name:
        return _bad("Give the team a name.")
    if survey.teams.filter(name__iexact=name).exists():
        return _bad("A team with that name already exists on this survey.")

    team = FieldTeam.objects.create(
        survey=survey, name=name,
        description=str(data.get("description") or "")[:2000],
        colour=str(data.get("colour") or "")[:9],
        created_by=request.user,
    )
    team.target = max(0, _int(data.get("target")))
    if team.target:
        team.save(update_fields=["target"])

    supervisor = _find_user(data.get("supervisor"))
    if supervisor:
        team.supervisor = supervisor
        team.save(update_fields=["supervisor", "updated_at"])
        svc.grant_device_access(survey, supervisor, decided_by=request.user)

    chat_svc.team_thread(team)
    TeamConfig.for_survey(survey)
    return JsonResponse({"ok": True, "team": team.as_dict()})


@login_required
@require_POST
def team_update(request, code, team_id):
    survey, access = svc.get_access(request, code, "can_manage_team")
    team = get_object_or_404(FieldTeam, id=team_id, survey=survey)
    data = _body(request) or request.POST
    fields = []

    if "name" in data:
        name = str(data["name"]).strip()[:80]
        if not name:
            return _bad("Give the team a name.")
        if survey.teams.filter(name__iexact=name).exclude(id=team.id).exists():
            return _bad("Another team already uses that name.")
        team.name = name
        fields.append("name")
    if "description" in data:
        team.description = str(data["description"])[:2000]
        fields.append("description")
    if "colour" in data:
        team.colour = str(data["colour"])[:9]
        fields.append("colour")
    if "is_active" in data:
        team.is_active = data["is_active"] in (True, "true", "1", 1, "on")
        fields.append("is_active")
    if "target" in data:
        try:
            team.target = max(0, int(data["target"] or 0))
            fields.append("target")
        except (TypeError, ValueError):
            return _bad("target must be a number.")
    if "area" in data:
        team.area = data["area"] if isinstance(data["area"], dict) else {}
        fields.append("area")
    if "supervisor" in data:
        handle = str(data["supervisor"] or "").strip()
        if not handle:
            team.supervisor = None
        else:
            user = _find_user(handle)
            if user is None:
                return _bad(f"No account found for “{handle}”.", 404)
            team.supervisor = user
            svc.grant_device_access(survey, user, decided_by=request.user)
        fields.append("supervisor")

    if fields:
        team.save(update_fields=fields + ["updated_at"])
    return JsonResponse({"ok": True, "team": team.as_dict()})


@login_required
@require_POST
def team_delete(request, code, team_id):
    survey, access = svc.get_access(request, code, "can_manage_team")
    team = get_object_or_404(FieldTeam, id=team_id, survey=survey)
    # Submissions are untouched: attribution is by enumerator, so
    # deleting a team never deletes data.
    team.delete()
    return JsonResponse({"ok": True})


@login_required
@require_POST
def member_add(request, code, team_id):
    survey, access = svc.get_access(request, code, "can_manage_team")
    team = get_object_or_404(FieldTeam, id=team_id, survey=survey)
    data = _body(request) or request.POST

    handles = data.get("users")
    if not isinstance(handles, list):
        handles = [data.get("user") or data.get("username")]

    added, missing = [], []
    for handle in handles:
        user = _find_user(handle)
        if user is None:
            missing.append(str(handle))
            continue
        member = svc.add_member(team, user, invited_by=request.user)
        added.append(member.as_dict())

    return JsonResponse({"ok": True, "added": added, "not_found": missing})


@login_required
@require_POST
def member_remove(request, code, team_id, member_id):
    survey, access = svc.get_access(request, code, "can_manage_team")
    team = get_object_or_404(FieldTeam, id=team_id, survey=survey)
    member = get_object_or_404(TeamMember, id=member_id, team=team)
    member.delete()
    return JsonResponse({"ok": True})


@login_required
@require_POST
def collaborator_add(request, code):
    survey, access = svc.get_access(request, code, "can_manage_team")
    data = _body(request) or request.POST
    user = _find_user(data.get("user") or data.get("username"))
    if user is None:
        return _bad("No account found with that username or email.", 404)
    if user.id == survey.owner_id:
        return _bad("You already own this survey.")

    role = data.get("role")
    if role not in dict(SurveyCollaborator.ROLE_CHOICES):
        role = "analyst"

    collab, _ = SurveyCollaborator.objects.update_or_create(
        survey=survey, user=user,
        defaults={"role": role, "invited_by": request.user},
    )
    chat_svc.survey_thread(survey)
    return JsonResponse({"ok": True, "collaborator": collab.as_dict()})


@login_required
@require_POST
def collaborator_remove(request, code, collab_id):
    survey, access = svc.get_access(request, code, "can_manage_team")
    get_object_or_404(SurveyCollaborator, id=collab_id, survey=survey).delete()
    return JsonResponse({"ok": True})


# ─────────────────────────────────────────────────────────────────────
# Validation suite (owner writes, supervisor only runs)
# ─────────────────────────────────────────────────────────────────────

@login_required
@require_POST
def validation_checks_save(request, code):
    """Replace the validation suite. Owner-only by design: this is what
    makes the checks un-editable from the supervisor's board."""
    survey, access = svc.get_access(request, code, "can_manage_validation")
    data = _body(request)
    if data is None or not isinstance(data.get("checks"), list):
        return _bad("Body must be JSON with a checks list.")

    keep = []
    for index, item in enumerate(data["checks"]):
        if not isinstance(item, dict):
            continue
        kind = item.get("kind")
        required = item.get("required", True) in (True, "true", "1", 1, "on")
        note = str(item.get("note") or "")[:200]

        if kind == "rule":
            rule = CleaningRule.objects.filter(
                id=item.get("rule_id"), survey=survey).first()
            if rule is None:
                continue
            check, _ = ValidationCheck.objects.update_or_create(
                survey=survey, rule=rule,
                defaults={"kind": "rule", "pipeline": None, "order": index,
                          "required": required, "note": note,
                          "created_by": request.user},
            )
        elif kind == "pipeline":
            pipeline = CleaningPipeline.objects.filter(
                id=item.get("pipeline_id"), survey=survey).first()
            if pipeline is None:
                continue
            check, _ = ValidationCheck.objects.update_or_create(
                survey=survey, pipeline=pipeline,
                defaults={"kind": "pipeline", "rule": None, "order": index,
                          "required": required, "note": note,
                          "created_by": request.user},
            )
        else:
            continue
        keep.append(check.id)

    survey.validation_checks.exclude(id__in=keep).delete()
    return JsonResponse({
        "ok": True,
        "checks": [c.as_dict() for c in survey.validation_checks.select_related(
            "rule", "pipeline")],
    })


@login_required
@require_POST
def validation_run(request, code):
    """Run the suite now. Supervisors may run it; they cannot change it."""
    survey, access = svc.get_access(request, code, "can_run_validation")
    data = _body(request) or {}

    team = None
    if data.get("team_id"):
        team = svc.team_for(access, _int(data["team_id"]))
    elif access.supervised_teams and not access.is_owner:
        team = access.supervised_teams[0]

    if not survey.validation_checks.exists():
        return _bad("No validation checks are set up on this survey yet.")

    run = svc.run_validation(survey, team=team, run_by=request.user,
                             trigger="manual")
    return JsonResponse({"ok": run.status == "complete", "run": run.as_dict()})


@login_required
@require_GET
def validation_history(request, code):
    survey, access = svc.get_access(request, code)
    qs = survey.validation_runs.select_related("run_by", "team")
    if not access.can_view_all_data and access.team_ids():
        qs = qs.filter(Q(team_id__in=access.team_ids()) | Q(team__isnull=True))
    return JsonResponse({"ok": True,
                         "runs": [r.as_dict() for r in qs[:30]]})


# ─────────────────────────────────────────────────────────────────────
# Supervisor board
# ─────────────────────────────────────────────────────────────────────

@login_required
@require_GET
def board_data(request, code, team_id):
    """Stats, per-member chart data, map points, issues and sign-off state."""
    survey, access = svc.get_access(request, code)
    team = svc.team_for(access, team_id)
    cfg = TeamConfig.for_survey(survey)

    start_date, end_date, start, end = _window(request, cfg)
    stats = svc.team_stats(team, start=start, end=end)

    issues = (svc.open_issues(survey, team=team)
              .select_related("submission", "rule", "assigned_to")
              .order_by("status", "-created_at")[:200])

    payload = {
        "ok": True,
        "now": timezone.now().isoformat(),
        "team": team.as_dict(),
        "access": access.as_dict(),
        "config": cfg.as_dict(),
        "window": {
            "from": start_date.isoformat() if start_date else None,
            "to": end_date.isoformat() if end_date else None,
        },
        "stats": stats,
        "issues": [i.as_dict() for i in issues],
        "checks": [c.as_dict()
                   for c in survey.validation_checks.select_related(
                       "rule", "pipeline")],
    }

    last = (survey.validation_runs
            .filter(Q(team=team) | Q(team__isnull=True)).first())
    payload["last_validation"] = last.as_dict() if last else None

    if start_date and end_date:
        payload["signoff"] = svc.signoff_snapshot(
            survey, team, start_date, end_date)
        existing = DataSignoff.objects.filter(
            survey=survey, team=team,
            period_start=start_date, period_end=end_date).first()
        payload["signoff"]["record"] = existing.as_dict() if existing else None

    payload["signoff_history"] = [
        s.as_dict() for s in svc.signoff_history(survey, team=team, limit=14)]

    if access.can_chat:
        payload["threads"] = [
            t.as_dict(chat_svc.unread_count(t, request.user))
            for t in chat_svc.threads_for(request.user, survey)
        ]

    return JsonResponse(payload)


@login_required
@require_GET
def board_rows(request, code, team_id):
    """The team's submissions, with answers and open flags."""
    survey, access = svc.get_access(request, code)
    team = svc.team_for(access, team_id)
    cfg = TeamConfig.for_survey(survey)
    _sd, _ed, start, end = _window(request, cfg)

    subs = team.submissions().select_related(
        "form_version", "device", "enumerator").prefetch_related("flags__rule")
    if start and end:
        subs = subs.filter(received_at__gte=start, received_at__lt=end)

    status = (request.GET.get("status") or "").strip()
    if status in ("complete", "partial", "flagged", "excluded"):
        subs = subs.filter(status=status)
    if request.GET.get("flagged") == "1":
        subs = subs.filter(flags__resolved=False).distinct()

    member_id = _int(request.GET.get("member"))
    if member_id:
        subs = subs.filter(enumerator_id=member_id)

    try:
        limit = min(1000, max(1, int(request.GET.get("limit", 300))))
    except (TypeError, ValueError):
        limit = 300

    rows = []
    for s in subs.order_by("-received_at")[:limit]:
        row = s.as_dict()
        row["enumerator"] = (s.enumerator.get_username()
                             if s.enumerator_id else None)
        rows.append(row)

    return JsonResponse({"ok": True, "rows": rows, "count": len(rows)})


@login_required
@require_GET
def board_export(request, code, team_id):
    """CSV of one team's data, if the owner allows supervisor exports."""
    survey, access = svc.get_access(request, code)
    team = svc.team_for(access, team_id)
    if not access.can_export:
        raise Http404

    cfg = TeamConfig.for_survey(survey)
    _sd, _ed, start, end = _window(request, cfg)

    schema = (survey.current_version.schema if survey.current_version
              else survey.draft_schema) or {}
    names = [q["name"] for q in schema.get("questions", [])
             if q.get("name") and q.get("type") not in ("section", "note")]

    subs = team.submissions().prefetch_related("flags__rule").select_related(
        "enumerator", "form_version")
    if start and end:
        subs = subs.filter(received_at__gte=start, received_at__lt=end)

    response = HttpResponse(content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = (
        f'attachment; filename="{survey.code}_{team.name[:20]}.csv"')
    writer = csv.writer(response)
    writer.writerow(
        ["uuid", "enumerator", "status", "received_at", "duration_s",
         "gps_lat", "gps_lng", "open_flags", "flag_details"] + names)

    for s in subs.order_by("received_at"):
        open_flags = [f for f in s.flags.all() if not f.resolved]
        row = [
            s.client_uuid,
            s.enumerator.get_username() if s.enumerator_id else "",
            s.status,
            s.received_at.isoformat() if s.received_at else "",
            round(s.duration_ms / 1000, 1),
            s.gps_lat if s.gps_lat is not None else "",
            s.gps_lng if s.gps_lng is not None else "",
            len(open_flags),
            " | ".join(f.detail for f in open_flags if f.detail),
        ]
        merged = {**s.answers, **s.calculations}
        for n in names:
            v = merged.get(n)
            if isinstance(v, list) and v and isinstance(v[0], dict):
                row.append(json.dumps(v, ensure_ascii=False))
            elif isinstance(v, list):
                row.append("|".join(str(x) for x in v))
            else:
                row.append("" if v is None else v)
        writer.writerow(row)
    return response


# ─────────────────────────────────────────────────────────────────────
# Issues
# ─────────────────────────────────────────────────────────────────────

@login_required
@require_GET
def issues_list(request, code):
    survey, access = svc.get_access(request, code)
    qs = DataIssue.objects.filter(survey=survey).select_related(
        "submission", "rule", "assigned_to")

    if request.GET.get("mine") == "1":
        qs = qs.filter(assigned_to=request.user)
    elif not access.can_view_all_data:
        scope = Q(team_id__in=access.team_ids())
        if access.is_member:
            scope |= Q(assigned_to=request.user)
        qs = qs.filter(scope)

    team_id = request.GET.get("team")
    if team_id:
        qs = qs.filter(team_id=team_id)

    state = (request.GET.get("status") or "open").lower()
    if state == "open":
        qs = qs.filter(status__in=DataIssue.OPEN_STATUSES)
    elif state in dict(DataIssue.STATUS_CHOICES):
        qs = qs.filter(status=state)

    return JsonResponse({
        "ok": True,
        "issues": [i.as_dict() for i in qs.order_by("status", "-created_at")[:300]],
    })


@login_required
@require_POST
def issue_create(request, code):
    """Raise an issue by hand — the supervisor's 'ask them to fix this'."""
    survey, access = svc.get_access(request, code, "can_raise_issues")
    data = _body(request) or {}

    sub = get_object_or_404(
        Submission, id=data.get("submission_id") or 0, survey=survey)
    if not access.can_view_all_data:
        team = svc.team_of_user(survey, sub.enumerator_id)
        if team is None or team.id not in access.team_ids():
            raise Http404

    field = str(data.get("field") or "")[:140]
    detail = str(data.get("detail") or "").strip()[:240]
    if not detail:
        return _bad("Say what needs fixing.")

    assignee = _resolve_user(data.get("assign_to"))
    if assignee is None and sub.enumerator_id:
        assignee = sub.enumerator

    now = timezone.now()
    issue = DataIssue.objects.create(
        survey=survey,
        team=svc.team_of_user(survey, sub.enumerator_id),
        submission=sub,
        signature=f"manual:{field}:{int(now.timestamp())}"[:140],
        field=field,
        detail=detail,
        source="manual",
        status="assigned" if assignee else "open",
        assigned_to=assignee,
        assigned_at=now if assignee else None,
        raised_by=request.user,
        note=str(data.get("note") or "")[:2000],
    )

    if data.get("notify", True) and issue.team_id:
        try:
            chat_svc.post_issue(
                chat_svc.team_thread(issue.team), request.user, issue)
        except Exception:
            pass

    return JsonResponse({"ok": True, "issue": issue.as_dict()})


@login_required
@require_POST
def issue_update(request, code, issue_id):
    """Assign, progress, resolve or dismiss an issue.

    A team member may move their own issue to being-fixed or resolved and
    add a note; only a supervisor or the owner may reassign or dismiss.
    """
    survey, access = svc.get_access(request, code)
    issue = get_object_or_404(
        DataIssue.objects.select_related("submission", "team"),
        id=issue_id, survey=survey)

    is_supervisor = access.is_owner or (
        issue.team_id and issue.team_id in access.team_ids()
        and access.is_supervisor)
    is_assignee = issue.assigned_to_id == request.user.id
    if not (is_supervisor or is_assignee or access.can_raise_issues):
        raise Http404

    data = _body(request) or {}
    now = timezone.now()
    fields = []

    if "assign_to" in data:
        if not is_supervisor:
            return _bad("Only a supervisor can reassign an issue.", 403)
        handle = data["assign_to"]
        user = None
        if handle:
            user = _resolve_user(handle)
            if user is None:
                return _bad("No account found for that person.", 404)
        issue.assigned_to = user
        issue.assigned_at = now if user else None
        if user and issue.status == "open":
            issue.status = "assigned"
            fields.append("status")
        fields += ["assigned_to", "assigned_at"]

    if "status" in data:
        status = data["status"]
        if status not in dict(DataIssue.STATUS_CHOICES):
            return _bad("Unknown status.")
        if status == "dismissed" and not is_supervisor:
            return _bad("Only a supervisor can dismiss an issue.", 403)
        issue.status = status
        if status in ("resolved", "dismissed"):
            issue.resolved_at = now
            issue.resolved_by = request.user
            fields += ["resolved_at", "resolved_by"]
        else:
            issue.resolved_at = None
            issue.resolved_by = None
            fields += ["resolved_at", "resolved_by"]
        if "status" not in fields:
            fields.append("status")

    if "note" in data:
        issue.note = str(data["note"])[:2000]
        fields.append("note")
    if "resolution_note" in data:
        issue.resolution_note = str(data["resolution_note"])[:2000]
        fields.append("resolution_note")

    if fields:
        issue.save(update_fields=list(set(fields)) + ["updated_at"])

    if data.get("message") and issue.team_id:
        try:
            chat_svc.post_issue(chat_svc.team_thread(issue.team),
                                request.user, issue,
                                body=str(data["message"])[:2000])
        except Exception:
            pass

    return JsonResponse({"ok": True, "issue": issue.as_dict()})


@login_required
@require_GET
def my_tasks(request, code):
    """An enumerator's own submissions and issues."""
    survey, access = svc.get_access(request, code)
    issues = DataIssue.objects.filter(
        survey=survey, assigned_to=request.user,
        status__in=DataIssue.OPEN_STATUSES,
    ).select_related("submission", "rule")

    subs = Submission.objects.filter(
        survey=survey, enumerator=request.user
    ).prefetch_related("flags__rule").order_by("-received_at")[:200]

    team = svc.team_of_user(survey, request.user.id)
    return JsonResponse({
        "ok": True,
        "team": team.as_dict() if team else None,
        "issues": [i.as_dict() for i in issues],
        "submissions": [s.as_dict() for s in subs],
    })


# ─────────────────────────────────────────────────────────────────────
# Sign-off
# ─────────────────────────────────────────────────────────────────────

@login_required
@require_GET
def signoff_state(request, code, team_id):
    survey, access = svc.get_access(request, code)
    team = svc.team_for(access, team_id)
    cfg = TeamConfig.for_survey(survey)
    start_date, end_date, _s, _e = _window(request, cfg)
    if not start_date:
        start_date, end_date = svc.period_bounds(cfg)

    snapshot = svc.signoff_snapshot(survey, team, start_date, end_date)
    record = DataSignoff.objects.filter(
        survey=survey, team=team,
        period_start=start_date, period_end=end_date).first()
    snapshot["record"] = record.as_dict() if record else None
    snapshot["history"] = [
        s.as_dict() for s in svc.signoff_history(survey, team=team, limit=14)]
    return JsonResponse({"ok": True, "signoff": snapshot})


@login_required
@require_POST
def signoff_sign(request, code, team_id):
    survey, access = svc.get_access(request, code, "can_signoff")
    team = svc.team_for(access, team_id)
    if team.supervisor_id != request.user.id and not access.is_owner:
        return _bad("Only this team's supervisor can sign off its data.", 403)

    cfg = TeamConfig.for_survey(survey)
    data = _body(request) or {}
    start_date = parse_date(data.get("period_start") or "")
    end_date = parse_date(data.get("period_end") or "")
    if not (start_date and end_date):
        start_date, end_date = svc.period_bounds(cfg)

    signoff, error = svc.sign_off(
        survey, team, request.user, start_date, end_date,
        note=str(data.get("note") or ""))
    if error:
        return JsonResponse(
            {"ok": False, "error": error,
             "signoff": signoff.as_dict() if signoff else None},
            status=409)
    return JsonResponse({"ok": True, "signoff": signoff.as_dict()})


@login_required
@require_POST
def signoff_return(request, code, signoff_id):
    """The owner sends a signed period back for more work."""
    survey, access = svc.get_access(request, code, "can_manage_team")
    signoff = get_object_or_404(
        DataSignoff.objects.select_related("team"),
        id=signoff_id, survey=survey)
    data = _body(request) or {}
    svc.return_signoff(signoff, request.user,
                       reason=str(data.get("reason") or ""))
    return JsonResponse({"ok": True, "signoff": signoff.as_dict()})


# ─────────────────────────────────────────────────────────────────────
# Chat (REST — the WebSocket is the fast path, this is the fallback)
# ─────────────────────────────────────────────────────────────────────

@login_required
@require_GET
def chat_threads(request, code):
    survey, access = svc.get_access(request, code)
    if not access.can_chat:
        return JsonResponse({"ok": True, "threads": [], "enabled": False})
    threads = chat_svc.threads_for(request.user, survey)
    return JsonResponse({
        "ok": True,
        "enabled": True,
        "you": request.user.id,
        "threads": [t.as_dict(chat_svc.unread_count(t, request.user))
                    for t in threads],
    })


@login_required
@require_GET
def chat_messages(request, code):
    survey, access = svc.get_access(request, code)
    thread = chat_svc.resolve_thread(
        survey, request.GET.get("thread") or 0, request.user)
    if thread is None:
        raise Http404
    try:
        after = int(request.GET.get("after") or 0)
    except (TypeError, ValueError):
        after = 0
    rows = chat_svc.messages(thread, after_id=after)
    if rows:
        chat_svc.mark_read(thread, request.user, rows[-1]["id"])
    return JsonResponse({"ok": True, "thread": thread.as_dict(),
                         "messages": rows})


@login_required
@require_POST
def chat_send(request, code):
    survey, access = svc.get_access(request, code)
    if not access.can_chat:
        return _bad("Chat is switched off for this survey.", 403)
    data = _body(request) or {}
    thread = chat_svc.resolve_thread(survey, data.get("thread") or 0,
                                     request.user)
    if thread is None:
        raise Http404
    body = str(data.get("body") or "").strip()
    if not body:
        return _bad("Message is empty.")
    context = data.get("context")
    msg = chat_svc.post(thread, request.user, body,
                        context=context if isinstance(context, dict) else None)
    return JsonResponse({"ok": True, "message": msg.as_dict()})


@login_required
@require_POST
def chat_read(request, code):
    survey, access = svc.get_access(request, code)
    data = _body(request) or {}
    thread = chat_svc.resolve_thread(survey, data.get("thread") or 0,
                                     request.user)
    if thread is None:
        raise Http404
    up_to = chat_svc.mark_read(thread, request.user, data.get("id"))
    return JsonResponse({"ok": True, "last_read_id": up_to})


@login_required
@require_POST
def chat_direct(request, code):
    """Open (or create) a direct line — the owner↔supervisor channel."""
    survey, access = svc.get_access(request, code)
    if not access.can_chat:
        return _bad("Chat is switched off for this survey.", 403)
    data = _body(request) or {}

    other = (_resolve_user(data.get("user"))
             or _resolve_user(data.get("user_id")))
    if other is None:
        return _bad("No account found for that person.", 404)
    if other.id == request.user.id:
        return _bad("You cannot open a direct chat with yourself.")

    # Only people already connected to this survey can be messaged.
    other_access = svc.access_for(other, survey)
    if not other_access.has_any_access:
        return _bad("That person is not part of this survey.", 403)

    thread = chat_svc.direct_thread(survey, request.user, other)
    return JsonResponse({"ok": True, "thread": thread.as_dict()})
