"""
kura/models.py — data model for Kura, the Knock-Knock survey lifecycle studio.

Design mirrors Hanns/Boardly conventions: an owner + short join code on the
top-level object, JSON blobs for the fast-evolving editor payloads, thin
relational tables only where the server genuinely needs to query.

Lifecycle covered by this one app:

    build  → Survey.draft_schema (JSON, edited in the builder)
    publish→ FormVersion (immutable snapshot; phones sync against versions)
    collect→ Submission (web runner or the mobile sync API)
    clean  → CleaningRule + SubmissionFlag + AnswerEdit (full audit trail)
    present→ kura/hanns_export.py turns results into a Hanns deck

Schema shape (Survey.draft_schema and FormVersion.schema):

    {
      "settings": {"anonymous": true, "one_response_per_device": false,
                   "shuffle_questions": false, "languages": ["en"]},
      "questions": [
        {
          "name": "age",                 # machine name, unique in form
          "type": "integer",             # see QUESTION_TYPES
          "label": "How old are you?",   # supports ${piping}
          "hint": "",
          "required": true,
          "choices": [{"value":"a","label":"A","goto":null}, …],  # selects
          "cascade_parent": "region",    # cascading selects
          "matrix": {"rows":[…], "columns":[…]},                  # grids
          "validate": {"min":0,"max":120,"regex":null,"message":""},
          "relevant": {"op":"and","rules":[                       # skip logic
              {"q":"consent","cmp":"eq","value":"yes"} ]},
          "calc": "weight / ((height/100)^2)",                    # computed
          "score": {"a": 3, "b": 1},                              # scoring
          "shuffle_choices": false,
          "appearance": "default"
        }, …
      ]
    }

Why structured-JSON logic instead of Kobo's XPath strings: it is directly
editable by a visual rule builder, evaluable identically in Python
(kura/logic.py) and JS (the runner), and composable to any nesting depth
(AND/OR groups of groups) — which XLSForm relevance strings famously fight.
"""

import hashlib
import random
import secrets
import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone


QUESTION_TYPES = [
    ("section", "Section header / note"),
    ("note", "Note / disclaimer (display only, no answer)"),
    ("text", "Short text"),
    ("long_text", "Paragraph"),
    ("integer", "Whole number"),
    ("decimal", "Decimal number"),
    ("select_one", "Choose one"),
    ("select_multiple", "Choose many"),
    ("rank", "Rank options"),
    ("likert", "Likert scale"),
    ("rating", "Star / numeric rating"),
    ("matrix", "Matrix / grid"),
    ("date", "Date"),
    ("time", "Time"),
    ("datetime", "Date & time"),
    ("gps", "GPS location"),
    ("photo", "Photo"),
    ("audio", "Audio"),
    ("signature", "Signature"),
    ("barcode", "Barcode / QR"),
    ("calculate", "Calculated value (hidden)"),
]


def _gen_code(length=6):
    """Same unambiguous alphabet as Boardly/Hanns join codes."""
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(random.choice(alphabet) for _ in range(length))


class Survey(models.Model):
    STATE_CHOICES = [
        ("draft", "Draft"),            # being built, nothing published
        ("collecting", "Collecting"),  # a version is published & open
        ("paused", "Paused"),          # published but not accepting data
        ("closed", "Closed"),          # collection finished
    ]

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name="kura_surveys", null=True, blank=True,
    )
    code = models.CharField(max_length=12, unique=True, db_index=True)
    title = models.CharField(max_length=140, default="Untitled survey")
    description = models.TextField(blank=True, default="")
    state = models.CharField(max_length=12, choices=STATE_CHOICES, default="draft")

    # Working copy edited by the builder; publishing snapshots it into a
    # FormVersion so in-flight edits never corrupt live collection.
    draft_schema = models.JSONField(default=dict)

    # Optional response quota (0 = unlimited) — closes collection at N.
    quota = models.PositiveIntegerField(default=0)

    DEVICE_POLICY_CHOICES = [
        ("allow_all", "Automatically allow all devices"),
        ("manual", "Require manual approval"),
        ("block_all", "Block all devices"),
    ]
    device_policy = models.CharField(
        max_length=20,
        choices=DEVICE_POLICY_CHOICES,
        default="manual",
        help_text=(
            "Controls whether registered phones may download and submit "
            "data to this form."
        ),
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return f"{self.title} ({self.code})"

    def save(self, *args, **kwargs):
        if not self.code:
            code = _gen_code()
            while Survey.objects.filter(code=code).exists():
                code = _gen_code()
            self.code = code
        super().save(*args, **kwargs)

    @property
    def current_version(self):
        return self.versions.filter(is_current=True).first()

    @property
    def is_open(self):
        if self.state != "collecting":
            return False
        if self.quota and self.submissions.filter(status__in=["complete", "flagged"]).count() >= self.quota:
            return False
        return True

    def as_dict(self, schema=None):
        v = self.current_version
        return {
            "code": self.code,
            "title": self.title,
            "description": self.description,
            "state": self.state,
            "quota": self.quota,
            "device_policy": self.device_policy,
            "version": v.version if v else 0,
            "schema": schema if schema is not None else (self.draft_schema or {}),
        }


    def device_access(self, device):
        """Return whether a registered device may use this survey."""
        if not device or not device.is_active:
            return False

        if self.device_policy == "block_all":
            return False

        permission = self.device_access_records.filter(device=device).first()

        # An explicit decision overrides allow_all, which allows an owner
        # to block a previously accepted device.
        if permission is not None:
            return bool(permission.allowed)

        return self.device_policy == "allow_all"


class FormVersion(models.Model):
    """Immutable published snapshot of a survey's schema.

    Every Submission records the version it was collected against, so the
    data table can render historic submissions with the exact form they
    answered — the thing that breaks in tools that mutate forms in place.
    """
    survey = models.ForeignKey(Survey, on_delete=models.CASCADE, related_name="versions")
    version = models.PositiveIntegerField()
    schema = models.JSONField(default=dict)
    schema_hash = models.CharField(max_length=64, blank=True)
    is_current = models.BooleanField(default=True)
    published_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="kura_published_versions",
    )
    published_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("survey", "version")]
        ordering = ["-version"]

    def __str__(self):
        return f"{self.survey.code} v{self.version}"

    def save(self, *args, **kwargs):
        import json
        self.schema_hash = hashlib.sha256(
            json.dumps(self.schema, sort_keys=True).encode()
        ).hexdigest()
        super().save(*args, **kwargs)


class Submission(models.Model):
    STATUS_CHOICES = [
        ("complete", "Complete"),
        ("partial", "Partial"),
        ("flagged", "Flagged"),     # kept in data but marked by cleaning
        ("excluded", "Excluded"),   # removed from analysis, never deleted
    ]
    SOURCE_CHOICES = [
        ("web", "Web runner"),
        ("api", "Mobile app (sync)"),
    ]

    survey = models.ForeignKey(Survey, on_delete=models.CASCADE, related_name="submissions")
    form_version = models.ForeignKey(
        FormVersion, on_delete=models.SET_NULL, null=True, related_name="submissions",
    )

    # Client-generated UUID — the idempotency key for offline sync. A phone
    # can push the same batch twice after a dropped connection and the
    # server will not duplicate rows.
    client_uuid = models.UUIDField(default=uuid.uuid4, unique=True, db_index=True)

    answers = models.JSONField(default=dict)      # {question_name: value}
    calculations = models.JSONField(default=dict) # server-evaluated calc fields
    score = models.FloatField(null=True, blank=True)

    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="complete")
    source = models.CharField(max_length=6, choices=SOURCE_CHOICES, default="web")

    device = models.ForeignKey(
        "Device", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="submissions",
    )
    enumerator = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="kura_submissions",
    )

    gps_lat = models.FloatField(null=True, blank=True)
    gps_lng = models.FloatField(null=True, blank=True)

    started_at = models.DateTimeField(null=True, blank=True)   # on the client
    submitted_at = models.DateTimeField(null=True, blank=True) # on the client
    received_at = models.DateTimeField(auto_now_add=True)      # on the server
    duration_ms = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["-received_at"]
        indexes = [
            models.Index(fields=["survey", "status"]),
            models.Index(fields=["survey", "received_at"]),
        ]

    def __str__(self):
        return f"{self.client_uuid} → {self.survey.code}"

    def answers_hash(self):
        import json
        return hashlib.sha256(
            json.dumps(self.answers, sort_keys=True).encode()
        ).hexdigest()

    def as_dict(self):
        return {
            "id": self.id,
            "uuid": str(self.client_uuid),
            "version": self.form_version.version if self.form_version else None,
            "answers": self.answers,
            "calculations": self.calculations,
            "score": self.score,
            "status": self.status,
            "source": self.source,
            "device": self.device.name if self.device else None,
            "gps": [self.gps_lat, self.gps_lng] if self.gps_lat is not None else None,
            "duration_ms": self.duration_ms,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "submitted_at": self.submitted_at.isoformat() if self.submitted_at else None,
            "received_at": self.received_at.isoformat() if self.received_at else None,
            "flags": [f.as_dict() for f in self.flags.filter(resolved=False)],
        }


class AnswerEdit(models.Model):
    """Audit trail for data cleaning — every manual/rule edit is recorded,
    old value preserved, so cleaning is reviewable and reversible."""
    submission = models.ForeignKey(Submission, on_delete=models.CASCADE, related_name="edits")
    field = models.CharField(max_length=80)
    old_value = models.JSONField(null=True, blank=True)
    new_value = models.JSONField(null=True, blank=True)
    reason = models.CharField(max_length=200, blank=True)
    rule_name = models.CharField(max_length=80, blank=True)  # set for auto recodes
    edited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="kura_edits",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


class CleaningRule(models.Model):
    """One configured detector/action. kura/cleaning.py interprets `config`.

    kinds: duplicate | outlier | speeder | straightliner | geofence |
           missing | logic | recode
    action: flag (default) | exclude | recode
    """
    KIND_CHOICES = [
        ("duplicate", "Duplicate responses"),
        ("outlier", "Numeric outliers"),
        ("speeder", "Too-fast completions"),
        ("straightliner", "Straight-lining"),
        ("geofence", "GPS outside area"),
        ("missing", "Missing critical answers"),
        ("logic", "Custom logic check"),
        ("recode", "Recode values"),
    ]
    ACTION_CHOICES = [("flag", "Flag"), ("exclude", "Exclude"), ("recode", "Recode")]

    survey = models.ForeignKey(Survey, on_delete=models.CASCADE, related_name="cleaning_rules")
    name = models.CharField(max_length=80)
    kind = models.CharField(max_length=16, choices=KIND_CHOICES)
    action = models.CharField(max_length=8, choices=ACTION_CHOICES, default="flag")
    config = models.JSONField(default=dict)
    enabled = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return f"{self.name} ({self.kind}) on {self.survey.code}"


class SubmissionFlag(models.Model):
    submission = models.ForeignKey(Submission, on_delete=models.CASCADE, related_name="flags")
    rule = models.ForeignKey(CleaningRule, on_delete=models.CASCADE, related_name="flags",
                             null=True, blank=True)
    field = models.CharField(max_length=80, blank=True)
    detail = models.CharField(max_length=240, blank=True)
    resolved = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def as_dict(self):
        return {
            "rule": self.rule.name if self.rule else "manual",
            "field": self.field,
            "detail": self.detail,
        }


class Device(models.Model):
    """One enumerator phone/tablet registered for the offline sync API."""
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name="kura_devices",
    )
    name = models.CharField(max_length=80, default="Phone")
    platform = models.CharField(max_length=40, blank=True)  # android/ios/…
    token = models.CharField(max_length=64, unique=True, db_index=True)
    is_active = models.BooleanField(default=True)
    last_seen = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.name} ({self.user})"

    @classmethod
    def issue(cls, user, name="Phone", platform=""):
        return cls.objects.create(
            user=user, name=name[:80], platform=platform[:40],
            token=secrets.token_hex(32),
        )

    def touch(self):
        self.last_seen = timezone.now()
        self.save(update_fields=["last_seen"])


class SurveyDeviceAccess(models.Model):
    """Per-survey access decision for one registered phone or tablet."""

    survey = models.ForeignKey(
        Survey,
        on_delete=models.CASCADE,
        related_name="device_access_records",
    )
    device = models.ForeignKey(
        Device,
        on_delete=models.CASCADE,
        related_name="survey_access_records",
    )
    allowed = models.BooleanField(default=False)
    requested_at = models.DateTimeField(auto_now_add=True)
    decided_at = models.DateTimeField(null=True, blank=True)
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="kura_device_access_decisions",
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["survey", "device"],
                name="unique_kura_survey_device_access",
            ),
        ]
        ordering = ["-requested_at"]

    def __str__(self):
        if self.allowed:
            status = "allowed"
        elif self.decided_at is None:
            status = "pending"
        else:
            status = "blocked"
        return f"{self.survey.code} · {self.device} · {status}"

    def allow(self, user=None):
        self.allowed = True
        self.decided_at = timezone.now()
        self.decided_by = user
        self.save(update_fields=["allowed", "decided_at", "decided_by"])

    def block(self, user=None):
        self.allowed = False
        self.decided_at = timezone.now()
        self.decided_by = user
        self.save(update_fields=["allowed", "decided_at", "decided_by"])

    def mark_pending(self):
        self.allowed = False
        self.decided_at = None
        self.decided_by = None
        self.save(update_fields=["allowed", "decided_at", "decided_by"])


class SyncLog(models.Model):
    """One sync exchange with a device — useful for support & debugging."""
    device = models.ForeignKey(Device, on_delete=models.CASCADE, related_name="sync_logs")
    survey = models.ForeignKey(Survey, on_delete=models.CASCADE, null=True, blank=True)
    pushed = models.PositiveIntegerField(default=0)      # submissions received
    duplicates = models.PositiveIntegerField(default=0)  # idempotent re-sends
    rejected = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


class LookupDataset(models.Model):
    """Preloaded reference data for scan-to-search / follow-up workflows.

    Upload a CSV (in the builder's left column); link a barcode question
    to it and the runner will match the scanned/typed code against
    ``key_column`` and can auto-fill other answers from the row — e.g.
    scan a participant ID from round 1 and pull their name, village and
    baseline values into the follow-up form. Rows live in a JSON column
    (fine into the tens of thousands); matching is exact,
    case-insensitive on the key.
    """

    survey = models.ForeignKey(Survey, on_delete=models.CASCADE,
                               related_name="lookups")
    name = models.CharField(max_length=80)
    key_column = models.CharField(max_length=80)
    columns = models.JSONField(default=list)   # ["participant_id", "name", …]
    rows = models.JSONField(default=list)      # [{"participant_id":"P001", …}, …]
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("survey", "name")]
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} ({len(self.rows or [])} rows)"


# ─────────────────────────────────────────────────────────────────────
# Visual cleaning pipeline, immutable result snapshots and analytics
# ─────────────────────────────────────────────────────────────────────

class CleaningPipeline(models.Model):
    """An ordered, reusable and non-destructive data-cleaning workflow."""

    survey = models.ForeignKey(
        Survey,
        on_delete=models.CASCADE,
        related_name="pipelines",
    )
    name = models.CharField(max_length=140, default="Main cleaning pipeline")
    description = models.TextField(blank=True, default="")
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="kura_cleaning_pipelines",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-id"]

    def __str__(self):
        return f"{self.survey.code} · {self.name}"


class PipelineStep(models.Model):
    OPERATION_CHOICES = [
        ("fill_missing", "Fill missing values"),
        ("filter_rows", "Filter rows"),
        ("drop_rows", "Drop selected rows"),
        ("drop_columns", "Drop columns"),
        ("keep_columns", "Keep selected columns"),
        ("rename_column", "Rename column"),
        ("recode", "Recode values"),
        ("replace", "Find and replace"),
        ("deduplicate", "Remove duplicates"),
        ("cast_type", "Change data type"),
        ("trim_text", "Trim text"),
        ("case_text", "Change text case"),
        ("calculate", "Calculated column"),
        ("outlier", "Outlier handling"),
        ("winsorize", "Winsorize"),
        ("scale", "Scale / normalize"),
        ("encode", "Encode categories"),
        ("sample", "Sample or subset"),
        ("regression_impute", "Regression imputation"),
    ]

    pipeline = models.ForeignKey(
        CleaningPipeline,
        on_delete=models.CASCADE,
        related_name="steps",
    )
    order = models.PositiveIntegerField(default=0)
    operation = models.CharField(max_length=40, choices=OPERATION_CHOICES)
    name = models.CharField(max_length=140, default="Cleaning step")
    config = models.JSONField(default=dict)
    enabled = models.BooleanField(default=True)
    stop_on_error = models.BooleanField(default=True)
    note = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["order", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["pipeline", "order"],
                name="unique_kura_pipeline_step_order",
            ),
        ]

    def __str__(self):
        return f"{self.pipeline.name} #{self.order}: {self.name}"


class CleaningRun(models.Model):
    STATUS_CHOICES = [
        ("queued", "Queued"),
        ("running", "Running"),
        ("complete", "Complete"),
        ("failed", "Failed"),
    ]

    pipeline = models.ForeignKey(
        CleaningPipeline,
        on_delete=models.CASCADE,
        related_name="runs",
    )
    label = models.CharField(max_length=140, blank=True, default="")
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="queued")
    source_count = models.PositiveIntegerField(default=0)
    result_count = models.PositiveIntegerField(default=0)
    excluded_count = models.PositiveIntegerField(default=0)
    column_count = models.PositiveIntegerField(default=0)
    summary = models.JSONField(default=dict)
    schema = models.JSONField(default=list)
    error = models.TextField(blank=True, default="")
    started_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    run_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="kura_cleaning_runs",
    )

    class Meta:
        ordering = ["-started_at", "-id"]

    def __str__(self):
        return f"{self.pipeline} · run {self.pk} · {self.status}"


class CleanedRecord(models.Model):
    run = models.ForeignKey(
        CleaningRun,
        on_delete=models.CASCADE,
        related_name="records",
    )
    source_submission = models.ForeignKey(
        Submission,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="cleaned_versions",
    )
    row_number = models.PositiveIntegerField()
    data = models.JSONField(default=dict)
    excluded = models.BooleanField(default=False)
    exclusion_reason = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["row_number", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["run", "row_number"],
                name="unique_kura_cleaned_run_row",
            ),
        ]

    def __str__(self):
        return f"Run {self.run_id} row {self.row_number}"


class CleaningChange(models.Model):
    CHANGE_TYPES = [
        ("impute", "Imputed value"),
        ("recode", "Recoded value"),
        ("replace", "Replaced value"),
        ("drop_row", "Dropped row"),
        ("drop_column", "Dropped column"),
        ("rename", "Renamed column"),
        ("cast", "Changed type"),
        ("outlier", "Outlier treatment"),
        ("calculate", "Calculated value"),
        ("encode", "Encoded value"),
        ("other", "Other"),
    ]

    run = models.ForeignKey(
        CleaningRun,
        on_delete=models.CASCADE,
        related_name="changes",
    )
    step = models.ForeignKey(
        PipelineStep,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="changes",
    )
    source_submission = models.ForeignKey(
        Submission,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="pipeline_changes",
    )
    row_number = models.PositiveIntegerField(null=True, blank=True)
    field = models.CharField(max_length=100, blank=True, default="")
    change_type = models.CharField(max_length=24, choices=CHANGE_TYPES, default="other")
    old_value = models.JSONField(null=True, blank=True)
    new_value = models.JSONField(null=True, blank=True)
    detail = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return f"Run {self.run_id} · {self.change_type} · {self.field}"


class AnalysisDashboard(models.Model):
    """Saved dashboard definition and cached analysis result for a cleaning run."""

    run = models.ForeignKey(
        CleaningRun,
        on_delete=models.CASCADE,
        related_name="dashboards",
    )
    name = models.CharField(max_length=140, default="Main dashboard")
    definition = models.JSONField(default=dict)
    cached_result = models.JSONField(default=dict)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="kura_dashboards",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-id"]

    def __str__(self):
        return f"{self.run} · {self.name}"
