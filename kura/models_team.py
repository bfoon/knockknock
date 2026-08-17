"""
kura/models_team.py — teams, supervision, chat, validation and sign-off.

Everything here is ADDITIVE: no existing Kura table is altered. Wire it up
with ONE line at the very BOTTOM of kura/models.py (after every existing
model, so the import finds Survey/Submission/CleaningRule already defined):

    from .models_team import *  # noqa: E402,F401,F403

Then:  python manage.py makemigrations kura && python manage.py migrate

── The concepts ──────────────────────────────────────────────────────

TeamConfig          one row per survey. "This form is collected by teams",
                    plus the end-of-day validation schedule and the
                    sign-off policy. Lives here instead of on Survey so
                    the core model needs no migration.

FieldTeam           a data-collection team on one survey, with one
                    supervisor. Membership is by USER, and the submissions
                    that belong to a team are the ones whose
                    Submission.enumerator is one of its members — which is
                    why a user may sit in at most one team per survey.

SurveyCollaborator  someone who works ON the form/data with the owner
                    (editor / analyst / viewer). Distinct from a field
                    team: collaborators build and analyse, teams collect.

SurveyInvite        one tokenised link, reused for every role. The
                    "supervisor link" you send is just an invite with
                    role="supervisor" bound to a team.

ValidationCheck     marks one CleaningRule or one CleaningPipeline as part
                    of the survey's validation suite. Only the owner can
                    create, reorder or delete these — the supervisor has no
                    endpoint that writes them, which is what makes them
                    locked from the supervisor's side.

ValidationRun       one execution of that suite (scheduled or manual),
                    with what it found.

DataIssue           "please fix this row". Deliberately NOT a foreign key
                    to SubmissionFlag: cleaning.run_rules() deletes and
                    recreates unresolved flags on every run, so an issue
                    hung off a flag row would vanish the moment the rules
                    re-ran. Instead an issue carries a stable signature
                    (rule id + field) against the submission and heals
                    itself when the underlying flag stops firing.

DataSignoff         the supervisor's statement that a period's data is
                    clean. Guarded server-side: it cannot be signed while
                    required checks still have open issues.

ChatThread /        survey room, per-team room, and owner↔supervisor
ChatMessage         direct rooms. Threads are keyed so get-or-create never
                    duplicates them.
"""

from __future__ import annotations

import secrets
from datetime import time as _time

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone

from .models import (
    CleaningPipeline,
    CleaningRule,
    Submission,
    Survey,
)

__all__ = [
    "TeamConfig",
    "FieldTeam",
    "TeamMember",
    "SurveyCollaborator",
    "SurveyInvite",
    "ValidationCheck",
    "ValidationRun",
    "DataIssue",
    "DataSignoff",
    "ChatThread",
    "ChatMessage",
    "ChatRead",
]

USER = settings.AUTH_USER_MODEL


def make_token() -> str:
    """URL-safe invite token (32 chars)."""
    return secrets.token_urlsafe(24)


# ─────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────

class TeamConfig(models.Model):
    """Per-survey team-collection settings. One row, created on demand."""

    survey = models.OneToOneField(
        Survey, on_delete=models.CASCADE, related_name="team_config",
    )

    # The builder's "data collection will be done by teams" switch.
    team_collection = models.BooleanField(default=False)

    # Sign-off policy.
    require_signoff = models.BooleanField(
        default=True,
        help_text="Supervisors must sign off each period before data is "
                  "treated as final.",
    )
    signoff_period = models.CharField(
        max_length=8,
        choices=[("day", "Daily"), ("week", "Weekly")],
        default="day",
    )
    allow_signoff_with_issues = models.BooleanField(
        default=False,
        help_text="Off by default: open issues on a required check block "
                  "sign-off.",
    )

    # What a supervisor may do beyond viewing their team's data.
    supervisor_can_edit_answers = models.BooleanField(default=False)
    supervisor_can_export = models.BooleanField(default=True)
    supervisor_can_see_other_teams = models.BooleanField(default=False)

    # The normal flow is that the SUPERVISOR runs the checks by hand once
    # the day's collection is finished — see teams.run_validation(). The
    # schedule below is an optional backstop for the day nobody presses the
    # button, and is off unless the owner turns it on and puts the
    # kura_run_validations command on cron or Celery beat.
    validation_enabled = models.BooleanField(default=False)
    validation_time = models.TimeField(
        default=_time(20, 0),
        help_text="If the automatic backstop is on, the local time it fires. "
                  "Set it late enough that a supervisor has had their chance "
                  "to run the checks themselves.",
    )
    validation_last_run_at = models.DateTimeField(null=True, blank=True)
    validation_last_run_by_person = models.BooleanField(
        default=False,
        help_text="Whether the last run was a person pressing the button "
                  "rather than the schedule.",
    )

    chat_enabled = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.survey.code} team config"

    @classmethod
    def for_survey(cls, survey) -> "TeamConfig":
        cfg, _ = cls.objects.get_or_create(survey=survey)
        return cfg

    def as_dict(self):
        return {
            "team_collection": self.team_collection,
            "require_signoff": self.require_signoff,
            "signoff_period": self.signoff_period,
            "allow_signoff_with_issues": self.allow_signoff_with_issues,
            "supervisor_can_edit_answers": self.supervisor_can_edit_answers,
            "supervisor_can_export": self.supervisor_can_export,
            "supervisor_can_see_other_teams": self.supervisor_can_see_other_teams,
            "validation_enabled": self.validation_enabled,
            "validation_time": self.validation_time.strftime("%H:%M"),
            "validation_last_run_at": (self.validation_last_run_at.isoformat()
                                       if self.validation_last_run_at else None),
            "validation_last_run_by_person": self.validation_last_run_by_person,
            "chat_enabled": self.chat_enabled,
        }


# ─────────────────────────────────────────────────────────────────────
# Teams and people
# ─────────────────────────────────────────────────────────────────────

class FieldTeam(models.Model):
    """One data-collection team on one survey."""

    survey = models.ForeignKey(
        Survey, on_delete=models.CASCADE, related_name="teams",
    )
    name = models.CharField(max_length=80)
    description = models.TextField(blank=True, default="")

    supervisor = models.ForeignKey(
        USER, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="kura_supervised_teams",
    )

    # Optional target for the board's progress bar (0 = no target).
    target = models.PositiveIntegerField(default=0)

    # Optional area shown on the supervisor's map:
    #   {"lat": 13.45, "lng": -16.57, "radius_km": 25}
    area = models.JSONField(default=dict, blank=True)

    colour = models.CharField(max_length=9, blank=True, default="")
    is_active = models.BooleanField(default=True)

    created_by = models.ForeignKey(
        USER, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="kura_created_teams",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["survey", "name"], name="unique_kura_team_name",
            ),
        ]

    def __str__(self):
        return f"{self.survey.code} · {self.name}"

    # ── membership ───────────────────────────────────────────────────

    def member_user_ids(self):
        return list(
            self.members.filter(is_active=True).values_list("user_id", flat=True)
        )

    def submissions(self):
        """Every submission attributed to a member of this team.

        Attribution runs through Submission.enumerator, which kura/api.py
        already sets to the syncing device's user. Web-runner submissions
        are anonymous and therefore belong to no team, by design.
        """
        return Submission.objects.filter(
            survey_id=self.survey_id, enumerator_id__in=self.member_user_ids(),
        )

    def as_dict(self, counts=None):
        data = {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "target": self.target,
            "area": self.area or {},
            "colour": self.colour,
            "is_active": self.is_active,
            "supervisor": (
                {"id": self.supervisor_id,
                 "username": self.supervisor.get_username(),
                 "name": (self.supervisor.get_full_name()
                          or self.supervisor.get_username())}
                if self.supervisor_id else None
            ),
            "member_count": self.members.filter(is_active=True).count(),
        }
        if counts:
            data.update(counts)
        return data


class TeamMember(models.Model):
    """One enumerator inside one team.

    `survey` is denormalised from the team so the database can enforce the
    one-team-per-survey rule that makes submission→team attribution
    unambiguous.
    """

    survey = models.ForeignKey(
        Survey, on_delete=models.CASCADE, related_name="team_members",
    )
    team = models.ForeignKey(
        FieldTeam, on_delete=models.CASCADE, related_name="members",
    )
    user = models.ForeignKey(
        USER, on_delete=models.CASCADE, related_name="kura_team_memberships",
    )
    display_name = models.CharField(max_length=80, blank=True, default="")
    is_active = models.BooleanField(default=True)

    invited_by = models.ForeignKey(
        USER, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="kura_team_invitations_sent",
    )
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["display_name", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["survey", "user"], name="unique_kura_member_per_survey",
            ),
        ]

    def __str__(self):
        return f"{self.user} in {self.team}"

    def save(self, *args, **kwargs):
        if self.team_id and not self.survey_id:
            self.survey_id = self.team.survey_id
        if not self.display_name and self.user_id:
            self.display_name = (self.user.get_full_name()
                                 or self.user.get_username())[:80]
        super().save(*args, **kwargs)

    def as_dict(self, counts=None):
        data = {
            "id": self.id,
            "user_id": self.user_id,
            "username": self.user.get_username(),
            "name": self.display_name or self.user.get_username(),
            "is_active": self.is_active,
            "joined_at": self.joined_at.isoformat() if self.joined_at else None,
        }
        if counts:
            data.update(counts)
        return data


class SurveyCollaborator(models.Model):
    """Someone the owner shares the form and its data with.

    editor  — build the form, edit data, manage quick rules and pipelines
    analyst — read data, run the studio, export; cannot change the form
    viewer  — read-only

    Validation checks stay owner-only for every role.
    """

    ROLE_CHOICES = [
        ("editor", "Editor"),
        ("analyst", "Analyst"),
        ("viewer", "Viewer"),
    ]

    survey = models.ForeignKey(
        Survey, on_delete=models.CASCADE, related_name="collaborators",
    )
    user = models.ForeignKey(
        USER, on_delete=models.CASCADE, related_name="kura_collaborations",
    )
    role = models.CharField(max_length=12, choices=ROLE_CHOICES, default="analyst")
    invited_by = models.ForeignKey(
        USER, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="kura_collaborator_invitations_sent",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["role", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["survey", "user"], name="unique_kura_collaborator",
            ),
        ]

    def __str__(self):
        return f"{self.user} · {self.role} on {self.survey.code}"

    def as_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "username": self.user.get_username(),
            "name": self.user.get_full_name() or self.user.get_username(),
            "role": self.role,
            "created_at": self.created_at.isoformat(),
        }


class SurveyInvite(models.Model):
    """A tokenised join link — the same model for every role.

    The "supervisor link" is simply role="supervisor" with a team set.
    Accepting is done by a signed-in user; the token binds their account
    to the role, it never grants anonymous access to response data.
    """

    ROLE_CHOICES = [
        ("supervisor", "Team supervisor"),
        ("member", "Team member (enumerator)"),
        ("editor", "Editor"),
        ("analyst", "Analyst"),
        ("viewer", "Viewer"),
    ]

    survey = models.ForeignKey(
        Survey, on_delete=models.CASCADE, related_name="invites",
    )
    team = models.ForeignKey(
        FieldTeam, on_delete=models.CASCADE, null=True, blank=True,
        related_name="invites",
    )
    role = models.CharField(max_length=12, choices=ROLE_CHOICES)
    token = models.CharField(max_length=64, unique=True, db_index=True,
                             default=make_token)
    label = models.CharField(max_length=120, blank=True, default="")
    email = models.EmailField(blank=True, default="")

    max_uses = models.PositiveIntegerField(
        default=1, help_text="0 = unlimited (useful for a team join link).",
    )
    uses = models.PositiveIntegerField(default=0)
    expires_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    created_by = models.ForeignKey(
        USER, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="kura_invites_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    last_accepted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return f"{self.role} invite for {self.survey.code}"

    @property
    def spent(self) -> bool:
        return bool(self.max_uses) and self.uses >= self.max_uses

    @property
    def expired(self) -> bool:
        return bool(self.expires_at and self.expires_at <= timezone.now())

    def is_valid(self) -> bool:
        return self.is_active and not self.spent and not self.expired

    def invalid_reason(self) -> str:
        if not self.is_active:
            return "This invitation has been revoked."
        if self.expired:
            return "This invitation has expired."
        if self.spent:
            return "This invitation has already been used."
        return ""

    def path(self) -> str:
        return f"/kura/{self.survey.code}/join/{self.token}/"

    def as_dict(self, base_url=""):
        return {
            "id": self.id,
            "role": self.role,
            "team_id": self.team_id,
            "team": self.team.name if self.team_id else None,
            "label": self.label,
            "email": self.email,
            "uses": self.uses,
            "max_uses": self.max_uses,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "is_active": self.is_active,
            "valid": self.is_valid(),
            "url": f"{base_url}{self.path()}" if base_url else self.path(),
            "created_at": self.created_at.isoformat(),
        }


# ─────────────────────────────────────────────────────────────────────
# Validation suite (owner-defined, supervisor-runnable, never editable
# by the supervisor)
# ─────────────────────────────────────────────────────────────────────

class ValidationCheck(models.Model):
    """One quick rule or one studio pipeline promoted to a validation check."""

    KIND_CHOICES = [
        ("rule", "Quick flag rule"),
        ("pipeline", "Data studio pipeline"),
    ]

    survey = models.ForeignKey(
        Survey, on_delete=models.CASCADE, related_name="validation_checks",
    )
    kind = models.CharField(max_length=10, choices=KIND_CHOICES)
    rule = models.ForeignKey(
        CleaningRule, on_delete=models.CASCADE, null=True, blank=True,
        related_name="validation_checks",
    )
    pipeline = models.ForeignKey(
        CleaningPipeline, on_delete=models.CASCADE, null=True, blank=True,
        related_name="validation_checks",
    )
    order = models.PositiveIntegerField(default=0)
    required = models.BooleanField(
        default=True,
        help_text="A required check with open issues blocks sign-off.",
    )
    note = models.CharField(max_length=200, blank=True, default="")

    created_by = models.ForeignKey(
        USER, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="kura_validation_checks",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["order", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["survey", "rule"], name="unique_kura_validation_rule",
                condition=Q(rule__isnull=False),
            ),
            models.UniqueConstraint(
                fields=["survey", "pipeline"],
                name="unique_kura_validation_pipeline",
                condition=Q(pipeline__isnull=False),
            ),
        ]

    def __str__(self):
        return f"{self.survey.code} check: {self.label()}"

    def label(self) -> str:
        if self.kind == "rule" and self.rule_id:
            return self.rule.name
        if self.kind == "pipeline" and self.pipeline_id:
            return self.pipeline.name
        return "(missing)"

    def as_dict(self):
        return {
            "id": self.id,
            "kind": self.kind,
            "rule_id": self.rule_id,
            "pipeline_id": self.pipeline_id,
            "label": self.label(),
            "order": self.order,
            "required": self.required,
            "note": self.note,
        }


class ValidationRun(models.Model):
    """One execution of the validation suite."""

    TRIGGER_CHOICES = [
        ("schedule", "Scheduled (end of day)"),
        ("manual", "Run now"),
        ("signoff", "Sign-off pre-check"),
    ]
    STATUS_CHOICES = [
        ("complete", "Complete"),
        ("failed", "Failed"),
    ]

    survey = models.ForeignKey(
        Survey, on_delete=models.CASCADE, related_name="validation_runs",
    )
    team = models.ForeignKey(
        FieldTeam, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="validation_runs",
    )
    trigger = models.CharField(max_length=10, choices=TRIGGER_CHOICES,
                               default="manual")
    status = models.CharField(max_length=10, choices=STATUS_CHOICES,
                              default="complete")
    passed = models.BooleanField(default=False)

    window_start = models.DateTimeField(null=True, blank=True)
    window_end = models.DateTimeField(null=True, blank=True)

    submissions_checked = models.PositiveIntegerField(default=0)
    issues_created = models.PositiveIntegerField(default=0)
    issues_open = models.PositiveIntegerField(default=0)
    issues_healed = models.PositiveIntegerField(default=0)

    summary = models.JSONField(default=list)
    error = models.TextField(blank=True, default="")

    run_by = models.ForeignKey(
        USER, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="kura_validation_runs",
    )
    started_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-started_at", "-id"]

    def __str__(self):
        return f"{self.survey.code} validation #{self.pk} ({self.status})"

    def as_dict(self):
        return {
            "id": self.id,
            "team_id": self.team_id,
            "trigger": self.trigger,
            "status": self.status,
            "passed": self.passed,
            "window_start": (self.window_start.isoformat()
                             if self.window_start else None),
            "window_end": (self.window_end.isoformat()
                           if self.window_end else None),
            "submissions_checked": self.submissions_checked,
            "issues_created": self.issues_created,
            "issues_open": self.issues_open,
            "issues_healed": self.issues_healed,
            "summary": self.summary,
            "error": self.error,
            "run_by": self.run_by.get_username() if self.run_by_id else None,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": (self.completed_at.isoformat()
                             if self.completed_at else None),
        }


# ─────────────────────────────────────────────────────────────────────
# Issues: "please fix this row"
# ─────────────────────────────────────────────────────────────────────

class DataIssue(models.Model):
    """A data problem raised against one submission and given to someone.

    Survives re-running the rules. See the module docstring for why this
    is not a foreign key to SubmissionFlag.
    """

    STATUS_CHOICES = [
        ("open", "Open"),
        ("assigned", "Assigned"),
        ("in_progress", "Being fixed"),
        ("resolved", "Resolved"),
        ("dismissed", "Dismissed"),
    ]
    OPEN_STATUSES = ("open", "assigned", "in_progress")

    SOURCE_CHOICES = [
        ("rule", "Raised by a rule"),
        ("manual", "Raised by a person"),
    ]

    survey = models.ForeignKey(
        Survey, on_delete=models.CASCADE, related_name="data_issues",
    )
    team = models.ForeignKey(
        FieldTeam, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="data_issues",
    )
    submission = models.ForeignKey(
        Submission, on_delete=models.CASCADE, related_name="issues",
    )
    rule = models.ForeignKey(
        CleaningRule, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="data_issues",
    )

    # Stable identity across rule re-runs: "rule:<id>:<field>" or
    # "manual:<field>:<n>". Unique per submission for rule-sourced issues.
    signature = models.CharField(max_length=140, db_index=True)

    field = models.CharField(max_length=140, blank=True, default="")
    detail = models.CharField(max_length=240, blank=True, default="")
    source = models.CharField(max_length=8, choices=SOURCE_CHOICES,
                              default="rule")
    status = models.CharField(max_length=12, choices=STATUS_CHOICES,
                              default="open")

    assigned_to = models.ForeignKey(
        USER, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="kura_assigned_issues",
    )
    raised_by = models.ForeignKey(
        USER, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="kura_raised_issues",
    )
    note = models.TextField(blank=True, default="")
    resolution_note = models.TextField(blank=True, default="")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    assigned_at = models.DateTimeField(null=True, blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.ForeignKey(
        USER, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="kura_resolved_issues",
    )

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["survey", "status"]),
            models.Index(fields=["team", "status"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["submission", "signature"],
                name="unique_kura_rule_issue",
                condition=Q(source="rule"),
            ),
        ]

    def __str__(self):
        return f"Issue #{self.pk} on submission {self.submission_id}"

    @property
    def is_open(self) -> bool:
        return self.status in self.OPEN_STATUSES

    def as_dict(self):
        sub = self.submission
        return {
            "id": self.id,
            "submission_id": self.submission_id,
            "submission_uuid": str(sub.client_uuid) if sub else None,
            "received_at": (sub.received_at.isoformat()
                            if sub and sub.received_at else None),
            "team_id": self.team_id,
            "rule": self.rule.name if self.rule_id else "manual",
            "rule_id": self.rule_id,
            "signature": self.signature,
            "field": self.field,
            "detail": self.detail,
            "source": self.source,
            "status": self.status,
            "note": self.note,
            "resolution_note": self.resolution_note,
            "assigned_to": (
                {"id": self.assigned_to_id,
                 "username": self.assigned_to.get_username(),
                 "name": (self.assigned_to.get_full_name()
                          or self.assigned_to.get_username())}
                if self.assigned_to_id else None
            ),
            "raised_by": (self.raised_by.get_username()
                          if self.raised_by_id else None),
            "created_at": self.created_at.isoformat(),
            "resolved_at": (self.resolved_at.isoformat()
                            if self.resolved_at else None),
        }


# ─────────────────────────────────────────────────────────────────────
# Sign-off
# ─────────────────────────────────────────────────────────────────────

class DataSignoff(models.Model):
    """A supervisor's statement that one period of data is clean."""

    STATUS_CHOICES = [
        ("pending", "Waiting for sign-off"),
        ("signed", "Signed off"),
        ("returned", "Returned by the owner"),
    ]

    survey = models.ForeignKey(
        Survey, on_delete=models.CASCADE, related_name="signoffs",
    )
    team = models.ForeignKey(
        FieldTeam, on_delete=models.CASCADE, null=True, blank=True,
        related_name="signoffs",
    )
    period_start = models.DateField()
    period_end = models.DateField()

    status = models.CharField(max_length=10, choices=STATUS_CHOICES,
                              default="pending")

    submissions_count = models.PositiveIntegerField(default=0)
    flagged_count = models.PositiveIntegerField(default=0)
    open_issues = models.PositiveIntegerField(default=0)

    validation_run = models.ForeignKey(
        ValidationRun, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="signoffs",
    )

    signed_by = models.ForeignKey(
        USER, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="kura_signoffs",
    )
    signed_at = models.DateTimeField(null=True, blank=True)
    note = models.TextField(blank=True, default="")

    returned_by = models.ForeignKey(
        USER, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="kura_returned_signoffs",
    )
    returned_at = models.DateTimeField(null=True, blank=True)
    returned_reason = models.TextField(blank=True, default="")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-period_start", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["survey", "team", "period_start", "period_end"],
                name="unique_kura_team_signoff",
                condition=Q(team__isnull=False),
            ),
            models.UniqueConstraint(
                fields=["survey", "period_start", "period_end"],
                name="unique_kura_survey_signoff",
                condition=Q(team__isnull=True),
            ),
        ]

    def __str__(self):
        who = self.team.name if self.team_id else "whole survey"
        return f"{self.survey.code} · {who} · {self.period_start} ({self.status})"

    def as_dict(self):
        return {
            "id": self.id,
            "team_id": self.team_id,
            "period_start": self.period_start.isoformat(),
            "period_end": self.period_end.isoformat(),
            "status": self.status,
            "submissions_count": self.submissions_count,
            "flagged_count": self.flagged_count,
            "open_issues": self.open_issues,
            "validation_run_id": self.validation_run_id,
            "signed_by": (self.signed_by.get_full_name()
                          or self.signed_by.get_username()) if self.signed_by_id else None,
            "signed_at": self.signed_at.isoformat() if self.signed_at else None,
            "note": self.note,
            "returned_by": (self.returned_by.get_username()
                            if self.returned_by_id else None),
            "returned_at": (self.returned_at.isoformat()
                            if self.returned_at else None),
            "returned_reason": self.returned_reason,
        }


# ─────────────────────────────────────────────────────────────────────
# Chat
# ─────────────────────────────────────────────────────────────────────

class ChatThread(models.Model):
    """A conversation attached to a survey.

    `key` makes get-or-create idempotent:
        "survey"            the whole working group
        "team:<id>"         a team room (owner + supervisor + members)
        "direct:<a>:<b>"    two people, user ids sorted ascending
    """

    KIND_CHOICES = [
        ("survey", "Survey room"),
        ("team", "Team room"),
        ("direct", "Direct message"),
    ]

    survey = models.ForeignKey(
        Survey, on_delete=models.CASCADE, related_name="chat_threads",
    )
    kind = models.CharField(max_length=8, choices=KIND_CHOICES, default="survey")
    key = models.CharField(max_length=80, db_index=True)
    team = models.ForeignKey(
        FieldTeam, on_delete=models.CASCADE, null=True, blank=True,
        related_name="chat_threads",
    )
    title = models.CharField(max_length=120, blank=True, default="")
    participants = models.ManyToManyField(
        USER, blank=True, related_name="kura_chat_threads",
    )

    created_by = models.ForeignKey(
        USER, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="kura_chat_threads_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["survey", "key"], name="unique_kura_thread_key",
            ),
        ]

    def __str__(self):
        return f"{self.survey.code} · {self.title or self.key}"

    def as_dict(self, unread=0):
        last = self.messages.order_by("-id").first()
        return {
            "id": self.id,
            "kind": self.kind,
            "key": self.key,
            "team_id": self.team_id,
            "title": self.title or self.key,
            "unread": unread,
            "updated_at": self.updated_at.isoformat(),
            "last": last.as_dict() if last else None,
        }


class ChatMessage(models.Model):
    KIND_CHOICES = [
        ("text", "Message"),
        ("system", "System note"),
        ("issue", "Issue reference"),
    ]

    thread = models.ForeignKey(
        ChatThread, on_delete=models.CASCADE, related_name="messages",
    )
    author = models.ForeignKey(
        USER, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="kura_chat_messages",
    )
    kind = models.CharField(max_length=8, choices=KIND_CHOICES, default="text")
    body = models.TextField(blank=True, default="")

    # Optional deep link, e.g. {"issue_id": 12, "submission_id": 340}
    context = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]
        indexes = [models.Index(fields=["thread", "id"])]

    def __str__(self):
        return f"msg {self.pk} in thread {self.thread_id}"

    def as_dict(self):
        return {
            "id": self.id,
            "thread_id": self.thread_id,
            "kind": self.kind,
            "body": self.body,
            "context": self.context or {},
            "author_id": self.author_id,
            "author": (self.author.get_full_name() or self.author.get_username())
                      if self.author_id else None,
            "username": self.author.get_username() if self.author_id else None,
            "created_at": self.created_at.isoformat(),
        }


class ChatRead(models.Model):
    """Per-user read cursor, so a thread can show an unread badge."""

    thread = models.ForeignKey(
        ChatThread, on_delete=models.CASCADE, related_name="reads",
    )
    user = models.ForeignKey(
        USER, on_delete=models.CASCADE, related_name="kura_chat_reads",
    )
    last_read_id = models.PositiveIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["thread", "user"], name="unique_kura_chat_read",
            ),
        ]

    def __str__(self):
        return f"{self.user} read {self.thread_id} to {self.last_read_id}"
