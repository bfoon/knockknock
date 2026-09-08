"""
kura/models_dashboard.py — live, buildable dashboards.

Why this is separate from ``AnalysisDashboard``
-----------------------------------------------
``AnalysisDashboard`` hangs off a *CleaningRun*: a frozen snapshot. That is
exactly right for "here is the analysis of the dataset we signed off on",
and exactly wrong for election night, a disaster response cell, or a field
team you are watching in real time — those need a board bound to a *source
that keeps changing*.

So a LiveDashboard binds to a **source**, not to a result:

    submissions  every submission as it lands (the default: fully live)
    pipeline     live submissions, pushed through a saved CleaningPipeline
                 in memory on every refresh — clean data, still live
    dataset      an uploaded CSV/Excel file (static)
    run          a completed CleaningRun (static, reproducible snapshot)

The first two update on their own. That is the whole point: you build the
board once, project it, and it keeps itself current as data arrives.

Tiles are stored relationally rather than as one JSON blob (the way
``AnalysisDashboard.definition`` does) because a live board asks per-tile
questions the server needs to answer: refresh just tile 7, does this tile
need the map, which tiles reference a column the pipeline just renamed.
Tile ``spec`` stays JSON — it is the fast-evolving part.
"""

from __future__ import annotations

import secrets

from django.conf import settings
from django.db import models

from .models import CleaningPipeline, CleaningRun, Survey, UploadedDataset


def _gen_token(length=22):
    return secrets.token_urlsafe(length)[:length]


class LiveDashboard(models.Model):
    SOURCE_CHOICES = [
        ("submissions", "Live survey submissions"),
        ("pipeline", "Live submissions through a cleaning pipeline"),
        ("dataset", "Uploaded file"),
        ("run", "Completed pipeline run (snapshot)"),
    ]

    THEME_CHOICES = [
        ("studio", "Studio (dark)"),
        ("ops", "Operations room (high contrast)"),
        ("light", "Light / projector"),
    ]

    survey = models.ForeignKey(
        Survey, on_delete=models.CASCADE, related_name="live_dashboards",
    )
    name = models.CharField(max_length=140, default="Live dashboard")
    description = models.TextField(blank=True, default="")

    # ── where the numbers come from ──────────────────────────────────
    source = models.CharField(max_length=12, choices=SOURCE_CHOICES,
                              default="submissions")
    pipeline = models.ForeignKey(
        CleaningPipeline, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="live_dashboards",
        help_text="Applied in memory on every refresh — no CleaningRun is written.",
    )
    dataset = models.ForeignKey(
        UploadedDataset, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="live_dashboards",
    )
    run = models.ForeignKey(
        CleaningRun, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="live_dashboards",
    )
    include_excluded = models.BooleanField(
        default=False,
        help_text="Include submissions the cleaning rules excluded.",
    )

    # ── board-wide behaviour ─────────────────────────────────────────
    filters = models.JSONField(
        default=list, blank=True,
        help_text="Board-wide filters, same condition shape as pipeline steps.",
    )
    filter_match = models.CharField(max_length=4, default="all")  # all | any
    theme = models.CharField(max_length=10, choices=THEME_CHOICES, default="studio")
    refresh_seconds = models.PositiveIntegerField(
        default=20,
        help_text="Polling fallback when the WebSocket is unavailable. 0 = manual.",
    )
    is_live = models.BooleanField(default=True)

    # ── sharing ──────────────────────────────────────────────────────
    is_public = models.BooleanField(
        default=False,
        help_text="Anyone with the link can view (read-only). Off by default.",
    )
    public_token = models.CharField(max_length=32, unique=True, db_index=True,
                                    blank=True)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="kura_live_dashboards",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-id"]
        indexes = [models.Index(fields=["survey", "-updated_at"])]

    def __str__(self):
        return f"{self.survey.code} · {self.name}"

    def save(self, *args, **kwargs):
        if not self.public_token:
            token = _gen_token()
            while LiveDashboard.objects.filter(public_token=token).exists():
                token = _gen_token()
            self.public_token = token
        super().save(*args, **kwargs)

    def rotate_token(self):
        """Invalidate the old share link (someone left the team, screen shared)."""
        self.public_token = ""
        self.save()
        return self.public_token

    @property
    def source_label(self):
        if self.source == "pipeline" and self.pipeline_id:
            return f"Live submissions → {self.pipeline.name}"
        if self.source == "dataset" and self.dataset_id:
            return self.dataset.name
        if self.source == "run" and self.run_id:
            return f"Run #{self.run_id} (snapshot)"
        return "Live submissions"

    @property
    def is_streaming(self):
        """True when new data can arrive without anyone re-running anything."""
        return self.is_live and self.source in ("submissions", "pipeline")

    def as_dict(self, with_tiles=True):
        payload = {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "source": self.source,
            "source_label": self.source_label,
            "pipeline_id": self.pipeline_id,
            "dataset_id": self.dataset_id,
            "run_id": self.run_id,
            "include_excluded": self.include_excluded,
            "filters": self.filters or [],
            "filter_match": self.filter_match,
            "theme": self.theme,
            "refresh_seconds": self.refresh_seconds,
            "is_live": self.is_live,
            "is_streaming": self.is_streaming,
            "is_public": self.is_public,
            "public_token": self.public_token,
            "updated_at": self.updated_at.isoformat(),
        }
        if with_tiles:
            payload["tiles"] = [t.as_dict() for t in self.tiles.all()]
        return payload


class DashboardTile(models.Model):
    """One card on the board.

    Geometry is a 12-column grid: ``x`` 0–11, ``w`` 1–12, ``y`` is the row
    and ``h`` the height in row units. Storing the grid server-side (rather
    than letting CSS decide) is what makes the layout survive a projector,
    a phone and a rebuild of the page.
    """

    KIND_CHOICES = [
        # single numbers
        ("kpi", "Big number"),
        ("delta", "Number with change"),
        ("progress", "Progress to target"),
        ("gauge", "Gauge"),
        # comparisons
        ("bar", "Bar chart"),
        ("hbar", "Horizontal bar"),
        ("pie", "Pie chart"),
        ("donut", "Donut chart"),
        ("leaderboard", "Ranked leaderboard"),
        # over time
        ("line", "Line chart"),
        ("area", "Area chart"),
        ("timeseries", "Time series"),
        # distributions & relationships
        ("histogram", "Distribution"),
        ("scatter", "Scatter plot"),
        # raw & spatial
        ("table", "Table"),
        ("map", "Map"),
        ("text", "Note / banner"),
    ]

    dashboard = models.ForeignKey(
        LiveDashboard, on_delete=models.CASCADE, related_name="tiles",
    )
    kind = models.CharField(max_length=16, choices=KIND_CHOICES, default="kpi")
    title = models.CharField(max_length=140, blank=True, default="")
    subtitle = models.CharField(max_length=200, blank=True, default="")

    x = models.PositiveSmallIntegerField(default=0)
    y = models.PositiveSmallIntegerField(default=0)
    w = models.PositiveSmallIntegerField(default=3)
    h = models.PositiveSmallIntegerField(default=2)

    spec = models.JSONField(default=dict)
    filters = models.JSONField(default=list, blank=True)
    filter_match = models.CharField(max_length=4, default="all")

    # Alerting: when this tile's headline value crosses a threshold the card
    # goes red on every open board. Built for "turnout below target in
    # region X" / "unassigned casualty reports over 20".
    alert = models.JSONField(default=dict, blank=True)

    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["y", "x", "order", "id"]

    def __str__(self):
        return f"{self.dashboard_id} · {self.kind} · {self.title or '(untitled)'}"

    def as_dict(self):
        return {
            "id": self.id,
            "kind": self.kind,
            "title": self.title,
            "subtitle": self.subtitle,
            "x": self.x, "y": self.y, "w": self.w, "h": self.h,
            "spec": self.spec or {},
            "filters": self.filters or [],
            "filter_match": self.filter_match,
            "alert": self.alert or {},
            "order": self.order,
        }
