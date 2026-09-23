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

import hashlib
import json
import re
import secrets

from django.conf import settings
from django.db import models
from django.utils import timezone

from .models import CleaningPipeline, CleaningRun, Survey, UploadedDataset


def _gen_token(length=22):
    return secrets.token_urlsafe(length)[:length]


# ─────────────────────────────────────────────────────────────────────
#  Themes
# ─────────────────────────────────────────────────────────────────────
#
# One source of truth: the builder, the public link and the presenter all
# paint from these tokens, and the server validates ``theme`` against the
# keys. Keys stay <= 10 characters because ``LiveDashboard.theme`` is a
# CharField(max_length=10) and existing rows already hold studio/ops/light.
#
# ``palette`` is the chart series order — the first colour is what a single
# series bar chart gets, so it doubles as the theme's accent.

THEME_PRESETS = {
    "studio": {
        "label": "Studio", "dark": True,
        "bg": "#07081a", "panel": "#10122c", "text": "#f8fbff", "muted": "#aeb7dc",
        "line": "rgba(255,255,255,.12)", "glow": "rgba(139,92,246,.24)",
        "palette": ["#22d3ee", "#ff3f98", "#ff8a1f", "#8b5cf6", "#22c55e", "#e8482b", "#38bdf8", "#f472b6"],
    },
    "ops": {
        "label": "Ops room", "dark": True,
        "bg": "#000208", "panel": "#080b18", "text": "#ffffff", "muted": "#c6cdf0",
        "line": "rgba(255,255,255,.2)", "glow": "rgba(34,211,238,.10)",
        "palette": ["#00e5ff", "#ffd400", "#ff3b30", "#34c759", "#af52de", "#ff9500", "#5ac8fa", "#ff2d55"],
    },
    "midnight": {
        "label": "Midnight", "dark": True,
        "bg": "#0b1020", "panel": "#131a2e", "text": "#e8ecf8", "muted": "#8e9ac0",
        "line": "rgba(148,163,209,.16)", "glow": "rgba(99,102,241,.22)",
        "palette": ["#818cf8", "#34d399", "#fbbf24", "#f472b6", "#60a5fa", "#a78bfa", "#fb7185", "#2dd4bf"],
    },
    "ocean": {
        "label": "Ocean", "dark": True,
        "bg": "#041a24", "panel": "#08283a", "text": "#e6f7ff", "muted": "#8fb9cc",
        "line": "rgba(125,211,252,.16)", "glow": "rgba(6,182,212,.25)",
        "palette": ["#22d3ee", "#38bdf8", "#2dd4bf", "#a3e635", "#facc15", "#fb923c", "#818cf8", "#f472b6"],
    },
    "forest": {
        "label": "Forest", "dark": True,
        "bg": "#07150e", "panel": "#0e2318", "text": "#eafbef", "muted": "#94b8a1",
        "line": "rgba(134,239,172,.15)", "glow": "rgba(34,197,94,.20)",
        "palette": ["#4ade80", "#facc15", "#2dd4bf", "#fb923c", "#a3e635", "#38bdf8", "#f87171", "#c084fc"],
    },
    "sunset": {
        "label": "Sunset", "dark": True,
        "bg": "#1a0a12", "panel": "#28111d", "text": "#fff1f5", "muted": "#d3a3b6",
        "line": "rgba(251,113,133,.18)", "glow": "rgba(249,115,22,.24)",
        "palette": ["#fb923c", "#f43f5e", "#facc15", "#e879f9", "#fda4af", "#f97316", "#a78bfa", "#fde047"],
    },
    "graphite": {
        "label": "Graphite", "dark": True,
        "bg": "#111214", "panel": "#1b1d21", "text": "#f2f3f5", "muted": "#9a9fa8",
        "line": "rgba(255,255,255,.10)", "glow": "rgba(255,255,255,.04)",
        "palette": ["#e5e7eb", "#60a5fa", "#f59e0b", "#10b981", "#f43f5e", "#a78bfa", "#94a3b8", "#fcd34d"],
    },
    "light": {
        "label": "Light", "dark": False,
        "bg": "#eef1f8", "panel": "#ffffff", "text": "#0b0e26", "muted": "#4a5378",
        "line": "rgba(10,14,40,.12)", "glow": "rgba(139,92,246,.10)",
        "palette": ["#6d28d9", "#0891b2", "#ea580c", "#db2777", "#16a34a", "#dc2626", "#2563eb", "#ca8a04"],
    },
    "paper": {
        "label": "Paper", "dark": False,
        "bg": "#f6f1e7", "panel": "#fffdf8", "text": "#2a241b", "muted": "#7a6f5e",
        "line": "rgba(60,45,20,.14)", "glow": "rgba(217,119,6,.08)",
        "palette": ["#b45309", "#0f766e", "#9f1239", "#4d7c0f", "#1d4ed8", "#7c3aed", "#c2410c", "#475569"],
    },
    "unblue": {
        "label": "UN Blue", "dark": False,
        "bg": "#eef5fb", "panel": "#ffffff", "text": "#0a2540", "muted": "#557089",
        "line": "rgba(0,60,120,.12)", "glow": "rgba(0,158,219,.10)",
        "palette": ["#009edb", "#0a2540", "#f5a623", "#4caf50", "#e2231a", "#7b61ff", "#00a99d", "#8a8d91"],
    },
}

FONT_CHOICES = ("archivo", "jakarta", "plex", "grotesk", "fraunces")
CARD_STYLES = ("glass", "solid", "outline", "raised")
BACKDROPS = ("glow", "mesh", "grid", "plain")
DENSITIES = ("cozy", "compact", "roomy")
PALETTES = ("theme", "vivid", "calm", "mono")
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def clean_theme_config(raw):
    """Keep only the knobs the renderer understands, each within range.

    The board is public-facing, so nothing from this dict is ever allowed to
    reach the page as free text — colours must be #rrggbb, everything else
    must be one of a known set.
    """
    raw = raw if isinstance(raw, dict) else {}
    out = {}
    accent = str(raw.get("accent") or "")
    if _HEX.match(accent):
        out["accent"] = accent.lower()
    for key, allowed in (("font", FONT_CHOICES), ("card", CARD_STYLES),
                         ("backdrop", BACKDROPS), ("density", DENSITIES),
                         ("palette", PALETTES)):
        if raw.get(key) in allowed:
            out[key] = raw[key]
    try:
        out["radius"] = max(0, min(28, int(raw.get("radius", 14))))
    except (TypeError, ValueError):
        out["radius"] = 14
    out["logo_text"] = str(raw.get("logo_text") or "")[:40]
    return out


class LiveDashboard(models.Model):
    SOURCE_CHOICES = [
        ("submissions", "Live survey submissions"),
        ("pipeline", "Live submissions through a cleaning pipeline"),
        ("dataset", "Uploaded file"),
        ("run", "Completed pipeline run (snapshot)"),
    ]

    THEME_CHOICES = [(key, preset["label"]) for key, preset in THEME_PRESETS.items()]

    EXPIRY_CHOICES = ("never", "1h", "24h", "7d", "30d", "custom")

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
    theme_config = models.JSONField(
        default=dict, blank=True,
        help_text="Accent, font, card style, backdrop, density, radius — see clean_theme_config().",
    )
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

    # ── publishing ───────────────────────────────────────────────────
    # The public link shows a *published version*, not the working copy.
    # Editing (and autosave) never reaches viewers until "Update published
    # version" — the same contract Tableau/Power BI use, and the one an
    # election-night screen needs: nobody watches you drag a half-built card.
    published_config = models.JSONField(
        null=True, blank=True,
        help_text="Frozen layout + theme served on the share link.",
    )
    published_at = models.DateTimeField(null=True, blank=True)
    published_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="kura_published_dashboards",
    )
    share_expires_at = models.DateTimeField(
        null=True, blank=True,
        help_text="After this moment the link shows 'expired'. Empty = never.",
    )
    allow_embed = models.BooleanField(
        default=False, help_text="Allow the public link inside an <iframe>.",
    )
    public_views = models.PositiveIntegerField(default=0)

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

    # ── publishing ───────────────────────────────────────────────────

    @property
    def share_expired(self):
        return bool(self.share_expires_at and self.share_expires_at <= timezone.now())

    @property
    def share_active(self):
        """Would an anonymous visitor holding the token see the board right now?"""
        return self.is_public and not self.share_expired

    def _draft_config(self, tiles=None):
        tiles = list(self.tiles.all()) if tiles is None else tiles
        return {
            "name": self.name,
            "description": self.description,
            "theme": self.theme,
            "theme_config": clean_theme_config(self.theme_config),
            "filters": self.filters or [],
            "filter_match": self.filter_match,
            "tiles": [t.as_dict() for t in tiles],
        }

    @staticmethod
    def signature(config):
        """Fingerprint a layout ignoring tile ids (which change on every save)."""
        body = dict(config or {})
        body.pop("signature", None)
        body.pop("options", None)
        body["tiles"] = [{k: v for k, v in t.items() if k != "id"}
                         for t in body.get("tiles", [])]
        return hashlib.md5(
            json.dumps(body, sort_keys=True, default=str).encode()
        ).hexdigest()[:16]

    def publish(self, user=None, options=None):
        """Freeze the working copy onto the share link and switch it on."""
        config = self._draft_config()
        config["signature"] = self.signature(config)
        config["options"] = options or {}
        self.published_config = config
        self.published_at = timezone.now()
        self.published_by = user if (user and user.is_authenticated) else None
        self.is_public = True
        self.save()
        return config

    def unpublish(self):
        """Switch the link off. The frozen version is kept for a quick re-publish."""
        self.is_public = False
        self.save(update_fields=["is_public", "updated_at"])

    def public_config(self):
        """What the share link renders: the frozen version, or — for boards
        shared before publishing existed — the live working copy."""
        if self.published_config:
            return self.published_config
        return self._draft_config()

    def publish_state(self, tiles=None):
        """draft | live | outdated | expired | off — drives the Publish button."""
        if not self.published_config:
            return "live" if self.is_public else "draft"
        if not self.is_public:
            return "off"
        if self.share_expired:
            return "expired"
        same = (self.signature(self._draft_config(tiles))
                == self.published_config.get("signature"))
        return "live" if same else "outdated"

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
        tiles = list(self.tiles.all()) if with_tiles else None
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
            "theme_config": clean_theme_config(self.theme_config),
            "refresh_seconds": self.refresh_seconds,
            "is_live": self.is_live,
            "is_streaming": self.is_streaming,
            "is_public": self.is_public,
            "public_token": self.public_token,
            "updated_at": self.updated_at.isoformat(),
            "published_at": self.published_at.isoformat() if self.published_at else None,
            "published_by": (self.published_by.get_username()
                             if self.published_by_id else None),
            "share_expires_at": (self.share_expires_at.isoformat()
                                 if self.share_expires_at else None),
            "allow_embed": self.allow_embed,
            "public_views": self.public_views,
            "publish_options": (self.published_config or {}).get("options", {}),
        }
        if with_tiles:
            payload["tiles"] = [t.as_dict() for t in tiles]
            payload["publish_state"] = self.publish_state(tiles)
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
        ("feed", "Live feed"),
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
