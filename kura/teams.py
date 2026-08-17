"""
kura/teams.py — the policy and service layer for team collection.

Views stay thin: they authenticate, parse, and call in here. Everything
that decides *who may do what*, *what counts as a problem*, and *when a
period may be signed off* lives in this module so the rules are stated
once.

Three things worth knowing before reading:

1. Team attribution runs through Submission.enumerator. kura/api.py
   already sets that to the syncing device's user, and TeamMember has a
   unique (survey, user) constraint, so a submission maps to at most one
   team with no schema change to Submission.

2. Issues heal themselves. cleaning.run_rules() deletes and recreates
   unresolved flags on every run, so sync_issues() re-derives the issue
   list from the current flags: a flag that stopped firing closes its
   issue, a flag that fires again reopens it.

3. The supervisor cannot edit the validation suite because there is no
   endpoint that lets them — ValidationCheck writes are owner-gated in
   team_views.py. Nothing is "locked" with a flag that could be flipped.
"""

from __future__ import annotations

from dataclasses import dataclass, field as dc_field
from datetime import date, datetime, time, timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Count, Max, Q
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone

from .cleaning import run_rules
from .models import (
    CleaningRun,
    Device,
    Submission,
    SubmissionFlag,
    Survey,
    SurveyDeviceAccess,
)
from .models_team import (
    DataIssue,
    DataSignoff,
    FieldTeam,
    SurveyCollaborator,
    TeamConfig,
    TeamMember,
    ValidationCheck,
    ValidationRun,
)

ROLE_OWNER = "owner"
ROLE_EDITOR = "editor"
ROLE_ANALYST = "analyst"
ROLE_VIEWER = "viewer"
ROLE_SUPERVISOR = "supervisor"
ROLE_MEMBER = "member"
ROLE_NONE = "none"


# ─────────────────────────────────────────────────────────────────────
# Access
# ─────────────────────────────────────────────────────────────────────

@dataclass
class Access:
    """What one user may do on one survey.

    A user can hold more than one relationship (an owner may also be a
    collaborator; a supervisor of team A may be a member of nothing).
    `role` is the strongest one, but the booleans are what views check.
    """

    survey: Survey
    user: object
    role: str = ROLE_NONE
    supervised_teams: list = dc_field(default_factory=list)
    membership: object = None
    collaborator: object = None

    # ── coarse gates ─────────────────────────────────────────────────

    @property
    def is_owner(self):
        return self.role == ROLE_OWNER

    @property
    def is_supervisor(self):
        return bool(self.supervised_teams)

    @property
    def is_member(self):
        return self.membership is not None

    @property
    def has_any_access(self):
        return self.role != ROLE_NONE

    # ── capability gates ─────────────────────────────────────────────

    @property
    def can_build(self):
        """Edit the questionnaire."""
        return self.role in (ROLE_OWNER, ROLE_EDITOR)

    @property
    def can_view_all_data(self):
        if self.role in (ROLE_OWNER, ROLE_EDITOR, ROLE_ANALYST, ROLE_VIEWER):
            return True
        if self.is_supervisor:
            return bool(self.config.supervisor_can_see_other_teams)
        return False

    @property
    def can_edit_data(self):
        if self.role in (ROLE_OWNER, ROLE_EDITOR):
            return True
        if self.is_supervisor:
            return bool(self.config.supervisor_can_edit_answers)
        return False

    @property
    def can_manage_rules(self):
        """Quick flag rules and studio pipelines."""
        return self.role in (ROLE_OWNER, ROLE_EDITOR)

    @property
    def can_manage_validation(self):
        """Promote a rule/pipeline to a validation check. Owner only —
        this is what makes the suite un-editable by the supervisor."""
        return self.is_owner

    @property
    def can_manage_team(self):
        return self.is_owner

    @property
    def can_run_validation(self):
        return self.is_owner or self.is_supervisor

    @property
    def can_raise_issues(self):
        return self.is_owner or self.is_supervisor or self.role == ROLE_EDITOR

    @property
    def can_signoff(self):
        return self.is_supervisor

    @property
    def can_export(self):
        if self.role in (ROLE_OWNER, ROLE_EDITOR, ROLE_ANALYST):
            return True
        if self.is_supervisor:
            return bool(self.config.supervisor_can_export)
        return False

    @property
    def can_chat(self):
        return self.has_any_access and bool(self.config.chat_enabled)

    # ── helpers ──────────────────────────────────────────────────────

    @property
    def config(self):
        if not hasattr(self, "_config"):
            self._config = TeamConfig.for_survey(self.survey)
        return self._config

    def team_ids(self):
        ids = [t.id for t in self.supervised_teams]
        if self.membership:
            ids.append(self.membership.team_id)
        return ids

    def may_see_team(self, team) -> bool:
        if self.is_owner or self.can_view_all_data:
            return True
        return team.id in self.team_ids()

    def as_dict(self):
        return {
            "role": self.role,
            "is_owner": self.is_owner,
            "is_supervisor": self.is_supervisor,
            "is_member": self.is_member,
            "supervises": [t.id for t in self.supervised_teams],
            "member_of": self.membership.team_id if self.membership else None,
            "can": {
                "build": self.can_build,
                "view_all_data": self.can_view_all_data,
                "edit_data": self.can_edit_data,
                "manage_rules": self.can_manage_rules,
                "manage_validation": self.can_manage_validation,
                "manage_team": self.can_manage_team,
                "run_validation": self.can_run_validation,
                "raise_issues": self.can_raise_issues,
                "signoff": self.can_signoff,
                "export": self.can_export,
                "chat": self.can_chat,
            },
        }


def access_for(user, survey) -> Access:
    """Resolve one user's standing on one survey."""
    if not user or not getattr(user, "is_authenticated", False):
        return Access(survey=survey, user=user, role=ROLE_NONE)

    if survey.owner_id == user.id:
        return Access(
            survey=survey, user=user, role=ROLE_OWNER,
            supervised_teams=list(survey.teams.filter(supervisor_id=user.id)),
            membership=TeamMember.objects.filter(
                survey=survey, user=user, is_active=True).first(),
        )

    supervised = list(survey.teams.filter(supervisor_id=user.id, is_active=True))
    membership = TeamMember.objects.filter(
        survey=survey, user=user, is_active=True).select_related("team").first()
    collab = SurveyCollaborator.objects.filter(survey=survey, user=user).first()

    if collab:
        role = collab.role
    elif supervised:
        role = ROLE_SUPERVISOR
    elif membership:
        role = ROLE_MEMBER
    else:
        role = ROLE_NONE

    return Access(
        survey=survey, user=user, role=role,
        supervised_teams=supervised, membership=membership,
        collaborator=collab,
    )


def get_access(request, code, need=None) -> tuple:
    """(survey, access) for a request, 404 unless `need` is satisfied.

    `need` is the name of an Access capability property, e.g.
    get_access(request, code, "can_manage_team").
    """
    survey = get_object_or_404(Survey, code=code.upper())
    access = access_for(request.user, survey)
    if not access.has_any_access:
        raise Http404
    if need and not getattr(access, need, False):
        raise Http404
    return survey, access


def team_for(access, team_id) -> FieldTeam:
    team = get_object_or_404(FieldTeam, id=team_id, survey=access.survey)
    if not access.may_see_team(team):
        raise Http404
    return team


# ─────────────────────────────────────────────────────────────────────
# Membership plumbing
# ─────────────────────────────────────────────────────────────────────

def add_member(team, user, invited_by=None) -> TeamMember:
    """Put a user in a team, moving them out of any other team on the
    same survey (the unique (survey, user) constraint requires it)."""
    TeamMember.objects.filter(survey_id=team.survey_id, user=user).exclude(
        team=team).delete()
    member, _ = TeamMember.objects.get_or_create(
        team=team, user=user,
        defaults={"survey_id": team.survey_id, "invited_by": invited_by},
    )
    if not member.is_active:
        member.is_active = True
        member.save(update_fields=["is_active"])
    grant_device_access(team.survey, user, decided_by=invited_by)
    return member


def grant_device_access(survey, user, decided_by=None) -> int:
    """Pre-approve every phone this user has registered.

    Without this a new enumerator joins the team and then sits blocked at
    'waiting for approval' on their handset under the default 'manual'
    device policy.
    """
    granted = 0
    for device in Device.objects.filter(user=user, is_active=True):
        access, _ = SurveyDeviceAccess.objects.get_or_create(
            survey=survey, device=device, defaults={"allowed": False},
        )
        if not access.allowed:
            access.allow(decided_by)
            granted += 1
    return granted


def team_of_user(survey, user_id):
    tm = TeamMember.objects.filter(
        survey=survey, user_id=user_id, is_active=True).select_related("team").first()
    return tm.team if tm else None


# ─────────────────────────────────────────────────────────────────────
# Periods
# ─────────────────────────────────────────────────────────────────────

def period_bounds(cfg, day=None) -> tuple:
    """(start_date, end_date) for the sign-off period containing `day`."""
    day = day or timezone.localdate()
    if cfg.signoff_period == "week":
        start = day - timedelta(days=day.weekday())
        return start, start + timedelta(days=6)
    return day, day


def to_datetime_range(start_date: date, end_date: date) -> tuple:
    """Datetimes covering [start_date 00:00, end_date 24:00).

    Aware under USE_TZ=True, naive otherwise, so the comparison against
    Submission.received_at is always like-for-like.
    """
    start = datetime.combine(start_date, time.min)
    end = datetime.combine(end_date + timedelta(days=1), time.min)
    if settings.USE_TZ:
        tz = timezone.get_current_timezone()
        start = timezone.make_aware(start, tz)
        end = timezone.make_aware(end, tz)
    return start, end


# ─────────────────────────────────────────────────────────────────────
# Issues
# ─────────────────────────────────────────────────────────────────────

def _signature(flag) -> str:
    return f"rule:{flag.rule_id or 0}:{flag.field or ''}"[:140]


def sync_issues(survey, actor=None, auto_assign=True) -> dict:
    """Re-derive the issue list from the survey's current open flags.

    Returns {"created", "reopened", "healed", "open"}.
    """
    now = timezone.now()
    member_team = {
        tm.user_id: tm.team
        for tm in TeamMember.objects.filter(
            survey=survey, is_active=True).select_related("team")
    }

    flags = (SubmissionFlag.objects
             .filter(submission__survey=survey, resolved=False)
             .select_related("submission", "rule"))

    live = set()
    created = reopened = healed = 0

    for flag in flags:
        sub = flag.submission
        sig = _signature(flag)
        live.add((sub.id, sig))
        team = member_team.get(sub.enumerator_id)

        # get_or_create rather than filter-then-create: it retries on the
        # unique constraint instead of raising if two runs overlap.
        issue, was_created = DataIssue.objects.get_or_create(
            submission_id=sub.id, signature=sig, source="rule",
            defaults={
                "survey": survey,
                "team": team,
                "rule": flag.rule,
                "field": (flag.field or "")[:140],
                "detail": (flag.detail or "")[:240],
                "status": ("assigned" if (auto_assign and sub.enumerator_id)
                           else "open"),
                "assigned_to_id": sub.enumerator_id if auto_assign else None,
                "assigned_at": (now if (auto_assign and sub.enumerator_id)
                                else None),
                "raised_by": actor,
            },
        )
        if was_created:
            created += 1
            continue

        changed = []
        if issue.status in ("resolved", "dismissed"):
            issue.status = "assigned" if issue.assigned_to_id else "open"
            issue.resolved_at = None
            issue.resolved_by = None
            issue.resolution_note = ""
            changed += ["status", "resolved_at", "resolved_by", "resolution_note"]
            reopened += 1
        if issue.detail != (flag.detail or "")[:240]:
            issue.detail = (flag.detail or "")[:240]
            changed.append("detail")
        if team and issue.team_id != team.id:
            issue.team = team
            changed.append("team")
        if changed:
            issue.save(update_fields=changed + ["updated_at"])

    # Heal: an open rule-issue whose flag no longer fires is fixed.
    for issue in DataIssue.objects.filter(
            survey=survey, source="rule", status__in=DataIssue.OPEN_STATUSES):
        if (issue.submission_id, issue.signature) not in live:
            issue.status = "resolved"
            issue.resolved_at = now
            issue.resolution_note = (
                "Cleared automatically — the check no longer flags this response."
            )
            issue.save(update_fields=["status", "resolved_at",
                                      "resolution_note", "updated_at"])
            healed += 1

    open_count = DataIssue.objects.filter(
        survey=survey, status__in=DataIssue.OPEN_STATUSES).count()

    return {"created": created, "reopened": reopened,
            "healed": healed, "open": open_count}


def open_issues(survey, team=None, start=None, end=None, assigned_to=None):
    qs = DataIssue.objects.filter(
        survey=survey, status__in=DataIssue.OPEN_STATUSES)
    if team is not None:
        qs = qs.filter(team=team)
    if start and end:
        qs = qs.filter(submission__received_at__gte=start,
                       submission__received_at__lt=end)
    if assigned_to is not None:
        qs = qs.filter(assigned_to=assigned_to)
    return qs


def blocking_issues(survey, team=None, start=None, end=None):
    """Open issues that stand in the way of sign-off.

    Anything raised by a REQUIRED validation check, plus anything a human
    raised by hand. An open issue from a non-required check is advisory.
    """
    required_rule_ids = set(
        ValidationCheck.objects
        .filter(survey=survey, required=True, rule__isnull=False)
        .values_list("rule_id", flat=True)
    )
    qs = open_issues(survey, team=team, start=start, end=end)
    return qs.filter(Q(rule_id__in=required_rule_ids) | Q(source="manual"))


# ─────────────────────────────────────────────────────────────────────
# Validation suite
# ─────────────────────────────────────────────────────────────────────

def run_validation(survey, team=None, run_by=None, trigger="manual",
                   window=None) -> ValidationRun:
    """Run the owner's validation checks, then refresh the issue list.

    Normally called by a SUPERVISOR pressing "run the checks" once their
    team has finished collecting for the day; the scheduled backstop and
    the owner use the same path.

    Scope, which matters when several supervisors work the same survey:
    the underlying flag rules are survey-wide (a duplicate can span two
    teams, so they have to be), and cleaning.run_rules() re-baselines
    every flag it owns. The RESULT is scoped — the ValidationRun's
    verdict, counts and pass/fail cover `team` only, and each supervisor
    sees their own team's issues. So one supervisor running the checks
    refreshes the shared flag set but never signs off anyone else's data.

    Because of that shared write, runs are serialised per survey: two
    supervisors pressing the button at the same moment would otherwise
    race on the delete-and-recreate inside run_rules and collide on
    DataIssue's unique constraint.

    `window` is (start_datetime, end_datetime) and is used only for
    reporting and sign-off maths — quick rules are always evaluated over
    the whole dataset.
    """
    from .chat import post_system, team_thread

    cfg = TeamConfig.for_survey(survey)
    if window is None:
        start_date, end_date = period_bounds(cfg)
        window = to_datetime_range(start_date, end_date)
    start, end = window

    with transaction.atomic():
        # Row lock held for the duration: the mutex for this survey.
        TeamConfig.objects.select_for_update().filter(survey=survey).first()
        return _run_validation_locked(
            survey, team, run_by, trigger, start, end, cfg,
            post_system, team_thread,
        )


def _run_validation_locked(survey, team, run_by, trigger, start, end, cfg,
                           post_system, team_thread) -> ValidationRun:
    run = ValidationRun.objects.create(
        survey=survey, team=team, trigger=trigger, run_by=run_by,
        window_start=start, window_end=end,
    )

    checks = list(
        survey.validation_checks.select_related("rule", "pipeline")
    )
    summary = []

    try:
        rule_ids = [c.rule_id for c in checks
                    if c.kind == "rule" and c.rule_id]
        if rule_ids:
            for entry in run_rules(survey, user=run_by, rule_ids=rule_ids):
                entry["kind"] = "rule"
                entry["required"] = next(
                    (c.required for c in checks if c.rule_id == entry.get("id")),
                    True,
                )
                summary.append(entry)

        for check in checks:
            if check.kind != "pipeline" or not check.pipeline_id:
                continue
            summary.append(_run_pipeline_check(check, run_by))

        stats = sync_issues(survey, actor=run_by)

        scope_team = team
        blocking = blocking_issues(survey, team=scope_team, start=start, end=end)

        subs = Submission.objects.filter(
            survey=survey, received_at__gte=start, received_at__lt=end)
        if scope_team:
            subs = subs.filter(enumerator_id__in=scope_team.member_user_ids())

        run.submissions_checked = subs.count()
        run.issues_created = stats["created"] + stats["reopened"]
        run.issues_healed = stats["healed"]
        run.issues_open = blocking.count()
        run.passed = run.issues_open == 0
        run.summary = summary
        run.status = "complete"
    except Exception as exc:  # a broken pipeline must not lose the record
        run.status = "failed"
        run.passed = False
        run.error = str(exc)[:2000]
        run.summary = summary
    finally:
        run.completed_at = timezone.now()
        run.save()

    cfg.validation_last_run_at = run.completed_at
    cfg.validation_last_run_by_person = run_by is not None
    cfg.save(update_fields=["validation_last_run_at",
                            "validation_last_run_by_person", "updated_at"])

    _announce_validation(survey, team, run, post_system, team_thread)
    return run


def _run_pipeline_check(check, run_by) -> dict:
    from .pipeline_engine import PipelineExecutor

    entry = {
        "kind": "pipeline",
        "id": check.pipeline_id,
        "rule": check.pipeline.name,
        "required": check.required,
    }
    crun = CleaningRun.objects.create(
        pipeline=check.pipeline,
        label=f"Validation {timezone.localtime():%Y-%m-%d %H:%M}",
        run_by=run_by,
    )
    try:
        PipelineExecutor(crun).execute()
        entry.update({
            "run_id": crun.id,
            "status": crun.status,
            "result_count": crun.result_count,
            "excluded": crun.excluded_count,
        })
    except Exception as exc:
        entry.update({"run_id": crun.id, "status": "failed",
                      "error": str(exc)[:400]})
    return entry


def _announce_validation(survey, team, run, post_system, team_thread):
    """Drop a system line in chat so nobody has to refresh a page to
    learn the checks ran."""
    try:
        if run.status == "failed":
            body = f"Data checks could not finish: {run.error[:160]}"
        elif run.passed:
            body = (f"Data checks passed — {run.submissions_checked} response"
                    f"{'' if run.submissions_checked == 1 else 's'} in this "
                    f"period, nothing outstanding.")
        else:
            body = (f"Data checks found {run.issues_open} issue"
                    f"{'' if run.issues_open == 1 else 's'} to resolve "
                    f"across {run.submissions_checked} response"
                    f"{'' if run.submissions_checked == 1 else 's'}.")
        targets = [team] if team else list(survey.teams.filter(is_active=True))
        for t in targets:
            post_system(team_thread(t), body,
                        context={"validation_run_id": run.id})
    except Exception:
        # Chat is a convenience; never let it fail a validation run.
        pass


# ─────────────────────────────────────────────────────────────────────
# Board statistics (charts + map for the supervisor)
# ─────────────────────────────────────────────────────────────────────

def team_stats(team, start=None, end=None, gps_limit=500) -> dict:
    """Everything the supervisor board plots.

    per_member  → the bar chart of who is submitting
    hourly      → the activity chart across the period
    points      → the map markers
    """
    subs = team.submissions()
    if start and end:
        subs = subs.filter(received_at__gte=start, received_at__lt=end)

    members = list(team.members.filter(is_active=True).select_related("user"))
    # .order_by() is load-bearing: Submission.Meta.ordering would
    # otherwise join received_at into the GROUP BY and return one row per
    # submission instead of one per enumerator.
    agg = (subs.order_by()
               .values("enumerator_id")
               .annotate(n=Count("id"), m=Max("received_at")))
    counts = {r["enumerator_id"]: r["n"] for r in agg}
    last_seen = {r["enumerator_id"]: r["m"] for r in agg}
    issue_counts = {
        r["assigned_to_id"]: r["n"]
        for r in (DataIssue.objects
                  .filter(team=team, status__in=DataIssue.OPEN_STATUSES)
                  .order_by()
                  .values("assigned_to_id")
                  .annotate(n=Count("id")))
    }

    per_member = []
    for m in members:
        seen = last_seen.get(m.user_id)
        per_member.append(m.as_dict({
            "submissions": counts.get(m.user_id, 0),
            "open_issues": issue_counts.get(m.user_id, 0),
            "last_submission": seen.isoformat() if seen else None,
        }))
    per_member.sort(key=lambda r: -r["submissions"])

    # Hourly activity across the window (local hours).
    hourly = {}
    for received in subs.values_list("received_at", flat=True):
        bucket = timezone.localtime(received).strftime("%Y-%m-%d %H:00")
        hourly[bucket] = hourly.get(bucket, 0) + 1
    series = [{"t": k, "n": hourly[k]} for k in sorted(hourly)]

    points = [
        {
            "id": s.id,
            "uuid": str(s.client_uuid),
            "lat": s.gps_lat,
            "lng": s.gps_lng,
            "status": s.status,
            "enumerator": (s.enumerator.get_username()
                           if s.enumerator_id else None),
            "received_at": s.received_at.isoformat() if s.received_at else None,
            "flags": s.flags.filter(resolved=False).count(),
        }
        for s in subs.filter(gps_lat__isnull=False, gps_lng__isnull=False)
                     .select_related("enumerator")
                     .prefetch_related("flags")
                     .order_by("-received_at")[:gps_limit]
    ]

    total = subs.count()
    flagged = subs.filter(flags__resolved=False).distinct().count()

    return {
        "totals": {
            "submissions": total,
            "flagged": flagged,
            "clean": max(0, total - flagged),
            "excluded": subs.filter(status="excluded").count(),
            "target": team.target,
            "with_gps": len(points),
            "members": len(members),
            "active_members": sum(1 for r in per_member if r["submissions"]),
        },
        "per_member": per_member,
        "hourly": series,
        "points": points,
        "area": team.area or {},
    }


# ─────────────────────────────────────────────────────────────────────
# Sign-off
# ─────────────────────────────────────────────────────────────────────

def signoff_snapshot(survey, team, start_date, end_date) -> dict:
    """The numbers a sign-off records, plus whether it is allowed."""
    cfg = TeamConfig.for_survey(survey)
    start, end = to_datetime_range(start_date, end_date)

    subs = Submission.objects.filter(
        survey=survey, received_at__gte=start, received_at__lt=end)
    if team:
        subs = subs.filter(enumerator_id__in=team.member_user_ids())

    flagged = subs.filter(flags__resolved=False).distinct().count()
    blocking = blocking_issues(survey, team=team, start=start, end=end)
    blocking_count = blocking.count()

    last_run = (ValidationRun.objects
                .filter(survey=survey, status="complete")
                .filter(Q(team=team) | Q(team__isnull=True))
                .order_by("-started_at").first())

    ran_this_period = bool(
        last_run and last_run.completed_at and last_run.completed_at >= start
    )

    reasons = []
    if not ran_this_period and survey.validation_checks.exists():
        reasons.append("Run the data checks for this period first.")
    if blocking_count and not cfg.allow_signoff_with_issues:
        reasons.append(
            f"{blocking_count} issue{'' if blocking_count == 1 else 's'} "
            f"still open on a required check."
        )
    if not subs.exists():
        reasons.append("There is no data in this period to sign off.")

    return {
        "period_start": start_date.isoformat(),
        "period_end": end_date.isoformat(),
        "submissions_count": subs.count(),
        "flagged_count": flagged,
        "open_issues": blocking_count,
        "advisory_issues": max(
            0, open_issues(survey, team=team, start=start, end=end).count()
               - blocking_count),
        "validation_run": last_run.as_dict() if last_run else None,
        "checks_ran_this_period": ran_this_period,
        "can_sign": not reasons,
        "blockers": reasons,
    }


def sign_off(survey, team, user, start_date, end_date, note="") -> tuple:
    """Record a sign-off. Returns (signoff, error_message)."""
    from .chat import post_system, team_thread

    snap = signoff_snapshot(survey, team, start_date, end_date)
    if not snap["can_sign"]:
        return None, " ".join(snap["blockers"])

    last_run_id = (snap["validation_run"] or {}).get("id")
    signoff, _ = DataSignoff.objects.get_or_create(
        survey=survey, team=team,
        period_start=start_date, period_end=end_date,
    )
    if signoff.status == "signed":
        return signoff, "This period has already been signed off."

    signoff.status = "signed"
    signoff.submissions_count = snap["submissions_count"]
    signoff.flagged_count = snap["flagged_count"]
    signoff.open_issues = snap["open_issues"]
    signoff.validation_run_id = last_run_id
    signoff.signed_by = user
    signoff.signed_at = timezone.now()
    signoff.note = (note or "")[:2000]
    signoff.returned_by = None
    signoff.returned_at = None
    signoff.returned_reason = ""
    signoff.save()

    try:
        who = user.get_full_name() or user.get_username()
        label = (f"{start_date:%d %b}" if start_date == end_date
                 else f"{start_date:%d %b} – {end_date:%d %b}")
        body = (f"{who} signed off {label}: "
                f"{snap['submissions_count']} response"
                f"{'' if snap['submissions_count'] == 1 else 's'}, "
                f"no outstanding issues.")
        if team:
            post_system(team_thread(team), body,
                        context={"signoff_id": signoff.id})
    except Exception:
        pass

    return signoff, ""


def return_signoff(signoff, user, reason="") -> DataSignoff:
    """The owner sends a signed period back for more work."""
    from .chat import post_system, team_thread

    signoff.status = "returned"
    signoff.returned_by = user
    signoff.returned_at = timezone.now()
    signoff.returned_reason = (reason or "")[:2000]
    signoff.save(update_fields=["status", "returned_by", "returned_at",
                                "returned_reason", "updated_at"])
    try:
        if signoff.team_id:
            post_system(
                team_thread(signoff.team),
                f"The owner returned {signoff.period_start:%d %b} for more "
                f"work: {signoff.returned_reason[:180] or 'no reason given'}",
                context={"signoff_id": signoff.id},
            )
    except Exception:
        pass
    return signoff


def signoff_history(survey, team=None, limit=30):
    qs = DataSignoff.objects.filter(survey=survey)
    if team is not None:
        qs = qs.filter(team=team)
    return list(qs.select_related("signed_by", "team")[:limit])


# ─────────────────────────────────────────────────────────────────────
# Scheduling
# ─────────────────────────────────────────────────────────────────────

def surveys_due_for_validation(now=None):
    """Surveys whose end-of-day validation time has passed and which have
    not been run since. Used by the kura_run_validations command."""
    now = now or timezone.now()
    local_now = timezone.localtime(now)
    today = local_now.date()
    due = []

    configs = (TeamConfig.objects
               .filter(validation_enabled=True, team_collection=True)
               .select_related("survey"))
    for cfg in configs:
        if cfg.survey.state not in ("collecting", "paused"):
            continue
        if local_now.time() < cfg.validation_time:
            continue
        last = cfg.validation_last_run_at
        if last and timezone.localtime(last).date() >= today:
            continue
        if not cfg.survey.validation_checks.exists():
            continue
        due.append(cfg.survey)
    return due
