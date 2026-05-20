"""
Attendance app — model layer.

Five core models. The shape mirrors what already works in the codebase:
  - One owner per top-level object (AttendanceEvent.owner), same as
    LiveSession / Questionnaire / Quiz.
  - Public access via a token + short numeric code (see LiveSession.code).
  - Dynamic forms via two tables: EventField (the schema) and
    RegistrationAnswer (the values). This is the same shape the polls app
    uses for Question / Answer, so it'll feel familiar.
  - Two-state attendance: REGISTERED → CHECKED_IN. Walk-ins enter directly
    at CHECKED_IN with `is_walk_in=True`.

A note on the "preset" question system you described:
  Presets are not stored in the DB. They live in PRESET_FIELDS below as a
  registry the organizer can drag into their form. When they pick one,
  we copy its definition into an EventField row owned by their event —
  after that they can rename, reorder, mark required, etc. without
  affecting any other event. That's the cleanest way to get
  "preconfigured options + customize" in one model.

Certificates work the same way — CERTIFICATE_TEMPLATES is a Python
registry of design recipes; each AttendanceEvent picks one by key and
optionally overlays its own logo at a chosen position.
"""

import secrets
import string
import uuid
from datetime import timedelta
from math import radians, cos, sin, asin, sqrt

from django.conf import settings
from django.db import models
from django.urls import reverse
from django.utils import timezone

# Re-export the venue + site-setting models so the rest of the app can
# import them from attendance.models like every other model. The actual
# definitions live in venue_models.py to keep this file's diff small.
from .venue_models import Venue, SiteSetting  # noqa: F401


def _gen_join_code():
    """6-digit numeric — matches the LiveSession pattern, easy to type."""
    return "".join(secrets.choice(string.digits) for _ in range(6))


def _gen_public_token():
    """Hard-to-guess token for the public registration URL."""
    return secrets.token_urlsafe(24)


# ───────────────────── Preset fields registry ─────────────────────
# What the drag panel offers. Each entry is a template the organizer can
# drag onto their form. Once dragged, it becomes an EventField row they
# can edit / rename / reorder independently. Keeping this as a Python
# registry (not a DB table) makes it trivial to ship new presets in a
# code release without a migration — same pattern as the icebreaker
# catalog in dashboard.html.

PRESET_FIELDS = [
    {"key": "full_name",      "label": "Full name",       "field_type": "text",     "required": True,  "icon": "bi-person"},
    {"key": "email",          "label": "Email address",   "field_type": "email",    "required": True,  "icon": "bi-envelope"},
    {"key": "phone",          "label": "Phone number",    "field_type": "phone",    "required": False, "icon": "bi-telephone"},
    {"key": "organization",   "label": "Organization",    "field_type": "text",     "required": False, "icon": "bi-building"},
    {"key": "job_title",      "label": "Job title",       "field_type": "text",     "required": False, "icon": "bi-briefcase"},
    {"key": "department",     "label": "Department",      "field_type": "text",     "required": False, "icon": "bi-diagram-3"},
    {"key": "gender",         "label": "Gender",          "field_type": "select",   "required": False, "icon": "bi-people",
     "options": ["Female", "Male", "Non-binary", "Prefer not to say"]},
    {"key": "country",        "label": "Country",         "field_type": "text",     "required": False, "icon": "bi-globe"},
    {"key": "dietary",        "label": "Dietary needs",   "field_type": "select",   "required": False, "icon": "bi-cup-hot",
     "options": ["None", "Vegetarian", "Vegan", "Halal", "Kosher", "Gluten-free", "Other"]},
    {"key": "accessibility",  "label": "Accessibility needs", "field_type": "textarea", "required": False, "icon": "bi-universal-access"},
    {"key": "expectations",   "label": "What do you hope to learn?", "field_type": "textarea", "required": False, "icon": "bi-lightbulb"},
    {"key": "consent_photo",  "label": "I consent to event photography", "field_type": "checkbox", "required": False, "icon": "bi-camera"},
    {"key": "consent_terms",  "label": "I accept the event terms",       "field_type": "checkbox", "required": True,  "icon": "bi-check-square"},
]


# ───────────────────── Certificate template registry ─────────────────────
# Ten built-in design recipes. Each one is a function name in
# services.draw_certificate_* — we keep the renderer as the source of
# truth for what the design *looks* like, and use this registry only to
# expose the picker UI (preview thumbnail, palette, mood).
#
# Adding an 11th template is: add a row here, add a draw_certificate_<key>
# function in services.py. No migration needed.

CERTIFICATE_TEMPLATES = [
    {
        "key": "classic",
        "name": "Classic Laurel",
        "subtitle": "Timeless, formal, gold border",
        "palette": ["#1e293b", "#c5a572", "#f8f5ee"],
        "mood": "formal",
    },
    {
        "key": "modern",
        "name": "Modern Minimalist",
        "subtitle": "Clean, lots of white space",
        "palette": ["#0f172a", "#7c3aed", "#ffffff"],
        "mood": "minimal",
    },
    {
        "key": "elegant",
        "name": "Elegant Script",
        "subtitle": "Soft cream with calligraphy accents",
        "palette": ["#3b2a1f", "#a07c3a", "#fdf8ef"],
        "mood": "formal",
    },
    {
        "key": "corporate",
        "name": "Corporate Slate",
        "subtitle": "Navy and silver, executive feel",
        "palette": ["#0b1f3a", "#94a3b8", "#f1f5f9"],
        "mood": "corporate",
    },
    {
        "key": "vibrant",
        "name": "Vibrant Geometric",
        "subtitle": "Bold shapes, energetic colour blocks",
        "palette": ["#7c3aed", "#22d3ee", "#fb7185"],
        "mood": "playful",
    },
    {
        "key": "academic",
        "name": "Academic Ribbon",
        "subtitle": "Burgundy seal, scholarly serif",
        "palette": ["#7f1d1d", "#fbbf24", "#fdfaf3"],
        "mood": "formal",
    },
    {
        "key": "tech",
        "name": "Tech Gradient",
        "subtitle": "Dark mode with neon accents",
        "palette": ["#0f172a", "#22d3ee", "#7c3aed"],
        "mood": "modern",
    },
    {
        "key": "botanical",
        "name": "Botanical Frame",
        "subtitle": "Hand-drawn leaves, natural tone",
        "palette": ["#14532d", "#a3b18a", "#f7f4ed"],
        "mood": "organic",
    },
    {
        "key": "minimal_lines",
        "name": "Minimal Lines",
        "subtitle": "Just two crisp lines, no fuss",
        "palette": ["#000000", "#737373", "#ffffff"],
        "mood": "minimal",
    },
    {
        "key": "celebration",
        "name": "Celebration Confetti",
        "subtitle": "Festive confetti corners",
        "palette": ["#db2777", "#facc15", "#0ea5e9"],
        "mood": "playful",
    },
]

CERTIFICATE_TEMPLATE_KEYS = {t["key"] for t in CERTIFICATE_TEMPLATES}
DEFAULT_CERTIFICATE_TEMPLATE = "classic"


# ───────────────────── Agenda templates ─────────────────────
# Visual styles for the agenda-table render. Each entry maps a key to
# a name + a short subtitle + a swatch palette for the design picker.
# The actual HTML/CSS for each style lives in templates/attendance/
# _agenda_styles/<key>.html — keep this registry in sync with that
# folder. Adding a new style means: (a) append here, (b) drop an HTML
# partial named the same key.

AGENDA_TEMPLATES = [
    {
        "key": "timeline",
        "name": "Timeline rail",
        "subtitle": "Vertical timeline with dot markers",
        "palette": ["#7c3aed", "#a78bfa", "#ede9fe"],
    },
    {
        "key": "boardroom",
        "name": "Boardroom table",
        "subtitle": "Classic three-column table, zebra rows",
        "palette": ["#0f172a", "#475569", "#e2e8f0"],
    },
    {
        "key": "swimlanes",
        "name": "Swim lanes",
        "subtitle": "Time on the left, sessions on the right",
        "palette": ["#0891b2", "#22d3ee", "#cffafe"],
    },
    {
        "key": "blocks",
        "name": "Time blocks",
        "subtitle": "Coloured cards stacked block-style",
        "palette": ["#f59e0b", "#fbbf24", "#fde68a"],
    },
    {
        "key": "minimal_grid",
        "name": "Minimal grid",
        "subtitle": "Spacious, thin dividers, all caps headers",
        "palette": ["#1f2937", "#9ca3af", "#f3f4f6"],
    },
    {
        "key": "duotone",
        "name": "Duotone bar",
        "subtitle": "Bold left bar with accent gradient",
        "palette": ["#db2777", "#7c3aed", "#fce7f3"],
    },
    {
        "key": "conference",
        "name": "Conference programme",
        "subtitle": "Tracks with session pills",
        "palette": ["#059669", "#10b981", "#d1fae5"],
    },
    {
        "key": "ticket_strip",
        "name": "Ticket strip",
        "subtitle": "Perforated tickets, one per session",
        "palette": ["#dc2626", "#f87171", "#fee2e2"],
    },
    {
        "key": "checklist",
        "name": "Live checklist",
        "subtitle": "Tick items off as they happen",
        "palette": ["#16a34a", "#4ade80", "#dcfce7"],
    },
    {
        "key": "neon_card",
        "name": "Neon card",
        "subtitle": "Dark cards with neon edge glow",
        "palette": ["#06b6d4", "#a855f7", "#0f172a"],
    },
]
AGENDA_TEMPLATE_KEYS = {t["key"] for t in AGENDA_TEMPLATES}
DEFAULT_AGENDA_TEMPLATE = "timeline"


# ───────────────────── Geofence helpers ─────────────────────

def haversine_metres(lat1, lng1, lat2, lng2):
    """
    Great-circle distance between two lat/lng points, in metres.

    Used to enforce on-site check-in. We tolerate a small radius
    (default 150 m, organiser-tunable) which is enough to cover a
    typical conference venue and tolerate phone GPS noise. Anything
    much tighter than ~50 m will start rejecting people standing right
    next to the door because urban GPS routinely drifts 30 m+.
    """
    # Mean Earth radius. Spherical model is plenty for venue-scale work.
    R = 6_371_000.0
    lat1, lng1, lat2, lng2 = map(radians, (lat1, lng1, lat2, lng2))
    dlat = lat2 - lat1
    dlng = lng2 - lng1
    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlng / 2) ** 2
    return 2 * R * asin(sqrt(a))


# ───────────────────── AttendanceEvent ─────────────────────

class AttendanceEvent(models.Model):
    """A meeting, training, workshop — anything that has a guest list."""

    REG_MODE_AUTO = "auto"
    REG_MODE_MANUAL = "manual"
    REG_MODE_CHOICES = [
        (REG_MODE_AUTO,   "Automatically accept registrations"),
        (REG_MODE_MANUAL, "Manually review each registration"),
    ]

    STATUS_DRAFT = "draft"
    STATUS_OPEN = "open"        # registrations accepted
    STATUS_CLOSED = "closed"    # registrations paused/stopped, event still upcoming
    STATUS_LIVE = "live"        # event in progress (check-in window open)
    STATUS_ENDED = "ended"      # event over — link/QR no longer accept anything
    STATUS_CHOICES = [
        (STATUS_DRAFT,  "Draft"),
        (STATUS_OPEN,   "Registration open"),
        (STATUS_CLOSED, "Registration closed"),
        (STATUS_LIVE,   "Live"),
        (STATUS_ENDED,  "Ended"),
    ]

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="attendance_events",
    )

    # Public-facing
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    agenda = models.TextField(
        blank=True,
        help_text="Markdown or plain text. Shown to attendees and used in emails. "
                  "If you also add structured AgendaItem rows, those render in the "
                  "fancy table; this free-text stays as a fallback for emails.",
    )
    # Which visual style to use when rendering the structured agenda
    # (the AgendaItem rows below). Falls back to the registry default.
    agenda_template_key = models.CharField(
        max_length=32, default=DEFAULT_AGENDA_TEMPLATE,
        help_text="Visual style for the agenda table. See AGENDA_TEMPLATES.",
    )
    cover_image = models.ImageField(upload_to="events/covers/", blank=True, null=True)
    location = models.CharField(max_length=240, blank=True)
    is_online = models.BooleanField(default=False)
    online_url = models.URLField(blank=True)

    # Timing
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    timezone_name = models.CharField(max_length=64, default="UTC")

    # Capacity + acceptance flow
    capacity = models.PositiveIntegerField(
        null=True, blank=True,
        help_text="Max attendees. Blank = unlimited.",
    )
    registration_mode = models.CharField(
        max_length=10, choices=REG_MODE_CHOICES, default=REG_MODE_AUTO,
    )
    registration_closes_at = models.DateTimeField(
        null=True, blank=True,
        help_text="Optional hard cutoff. Defaults to event start time.",
    )
    allow_walk_ins = models.BooleanField(
        default=True,
        help_text="If true, an unregistered attendee scanning the QR can fill the form on the spot.",
    )

    # ── Geofenced on-site check-in ─────────────────────────────
    # When enabled, anyone who pre-registered must be physically at the
    # venue to check in. The browser asks for location, we Haversine
    # against (geofence_lat, geofence_lng) and reject anyone outside the
    # radius. Walk-ins and organiser-driven manual check-ins are *not*
    # subject to this — they're either at the door already, or the
    # organiser is taking responsibility.
    #
    # The `venue` FK below is the optional shortcut: pick a saved venue
    # and the geofence_lat/lng/radius columns auto-fill from its
    # defaults at save time. We still keep the lat/lng/radius columns
    # on the event itself so deactivating the venue later doesn't break
    # an already-running event — the event has its own copy.
    venue = models.ForeignKey(
        "attendance.Venue",
        on_delete=models.SET_NULL,
        null=True, blank=True, related_name="events",
        help_text="Pre-defined venue. If set, geofence lat/lng/radius "
                  "default to the venue's values but can be overridden.",
    )
    require_geofence = models.BooleanField(
        default=False,
        help_text="Force attendees to be physically at the venue to self-check-in.",
    )
    geofence_lat = models.FloatField(null=True, blank=True)
    geofence_lng = models.FloatField(null=True, blank=True)
    geofence_radius_m = models.PositiveIntegerField(
        default=150,
        help_text="Allowed distance in metres. 150 m is a sensible default — phone GPS drifts.",
    )

    # Status + access
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=STATUS_DRAFT)
    code = models.CharField(
        max_length=6, unique=True, default=_gen_join_code, db_index=True,
        help_text="6-digit code for typed entry — same UX as live sessions.",
    )
    public_token = models.CharField(
        max_length=64, unique=True, default=_gen_public_token,
        help_text="Goes in the shareable URL. Rotate to invalidate old links.",
    )

    # Post-event extras
    generate_certificates = models.BooleanField(default=False)
    certificate_template = models.TextField(
        blank=True,
        help_text="Optional HTML/text template. {{ name }} and {{ event }} get substituted.",
    )
    # NEW: which built-in design to render. The legacy free-text field
    # above is kept so older events don't break; new events use the
    # design-key system.
    certificate_template_key = models.CharField(
        max_length=32, default=DEFAULT_CERTIFICATE_TEMPLATE,
        help_text="Which built-in design to render. See CERTIFICATE_TEMPLATES.",
    )
    # Logo overlay. The user can drag the logo around the preview and we
    # store the final position as percentages so it scales with the
    # canvas. 0%/0% = top-left of the cert; 50%/8% places it centered
    # near the top, etc. Width is also a percentage of canvas width so
    # it stays proportional when we render at PDF resolution.
    certificate_logo = models.ImageField(
        upload_to="events/certificates/logos/", blank=True, null=True,
        help_text="Optional logo. PNG with transparency works best.",
    )
    certificate_logo_x_pct = models.FloatField(
        default=50.0,
        help_text="Horizontal position of the logo's centre, as a % of canvas width.",
    )
    certificate_logo_y_pct = models.FloatField(
        default=8.0,
        help_text="Vertical position of the logo's centre, as a % of canvas height.",
    )
    certificate_logo_width_pct = models.FloatField(
        default=15.0,
        help_text="Logo width as a % of canvas width. Height is auto-scaled.",
    )

    # Bookkeeping
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-starts_at"]
        indexes = [
            models.Index(fields=["status", "starts_at"]),
            models.Index(fields=["owner", "-starts_at"]),
        ]

    def __str__(self):
        return f"{self.title} ({self.starts_at:%Y-%m-%d})"

    # ── Lifecycle helpers ───────────────────────────────────────

    def effective_registration_deadline(self):
        """When does registration *actually* close? Explicit field wins, else event start."""
        return self.registration_closes_at or self.starts_at

    def is_registration_open(self):
        """Single source of truth for 'can someone register right now'."""
        if self.status not in (self.STATUS_OPEN, self.STATUS_LIVE):
            return False
        if timezone.now() >= self.effective_registration_deadline() and self.status != self.STATUS_LIVE:
            return False
        if self.capacity and self.accepted_count() >= self.capacity:
            return False
        return True

    def is_check_in_open(self):
        """Can a registered attendee tap 'I'm here' right now?"""
        if self.status == self.STATUS_ENDED:
            return False
        # Allow check-in from 2 hours before start through end time.
        now = timezone.now()
        return (self.starts_at - timedelta(hours=2)) <= now <= self.ends_at

    def is_qr_active(self):
        """The combined 'is the link/QR still useful' check called from public views."""
        return self.status != self.STATUS_ENDED and timezone.now() <= self.ends_at

    def has_geofence(self):
        """Geofencing is on AND we have valid coordinates to enforce against."""
        return bool(
            self.require_geofence
            and self.geofence_lat is not None
            and self.geofence_lng is not None
        )

    def distance_from_venue_m(self, lat, lng):
        """Helper for views — returns None if no geofence configured."""
        if self.geofence_lat is None or self.geofence_lng is None:
            return None
        return haversine_metres(self.geofence_lat, self.geofence_lng, lat, lng)

    def is_within_geofence(self, lat, lng):
        """True if the given coords are inside the configured radius."""
        if not self.has_geofence():
            return True  # geofence not enforced
        d = self.distance_from_venue_m(lat, lng)
        return d is not None and d <= self.geofence_radius_m

    def accepted_count(self):
        """Counts ACCEPTED + CHECKED_IN. PENDING and DECLINED don't take a seat."""
        return self.registrations.filter(
            status__in=[
                Registration.STATUS_ACCEPTED,
                Registration.STATUS_CHECKED_IN,
            ],
        ).count()

    def checked_in_count(self):
        return self.registrations.filter(status=Registration.STATUS_CHECKED_IN).count()

    def pending_count(self):
        return self.registrations.filter(status=Registration.STATUS_PENDING).count()

    def declined_count(self):
        return self.registrations.filter(status=Registration.STATUS_DECLINED).count()

    def walk_in_count(self):
        return self.registrations.filter(
            is_walk_in=True,
            status=Registration.STATUS_CHECKED_IN,
        ).count()

    def seats_remaining(self):
        if not self.capacity:
            return None
        return max(self.capacity - self.accepted_count(), 0)

    def get_public_register_url(self):
        return reverse("attendance:public_register",
                       kwargs={"public_token": self.public_token})

    def get_public_qr_url(self):
        return reverse("attendance:public_qr",
                       kwargs={"public_token": self.public_token})

    def get_manage_url(self):
        return reverse("attendance:event_detail", kwargs={"pk": self.pk})


# ───────────────────── EventField ─────────────────────

class EventField(models.Model):
    """One question in the registration form for an event."""

    TYPE_TEXT = "text"
    TYPE_TEXTAREA = "textarea"
    TYPE_EMAIL = "email"
    TYPE_PHONE = "phone"
    TYPE_NUMBER = "number"
    TYPE_DATE = "date"
    TYPE_SELECT = "select"
    TYPE_MULTI = "multi"
    TYPE_CHECKBOX = "checkbox"
    TYPE_CHOICES = [
        (TYPE_TEXT,     "Short text"),
        (TYPE_TEXTAREA, "Long text"),
        (TYPE_EMAIL,    "Email"),
        (TYPE_PHONE,    "Phone"),
        (TYPE_NUMBER,   "Number"),
        (TYPE_DATE,     "Date"),
        (TYPE_SELECT,   "Single choice"),
        (TYPE_MULTI,    "Multiple choice"),
        (TYPE_CHECKBOX, "Yes/No checkbox"),
    ]

    event = models.ForeignKey(
        AttendanceEvent,
        on_delete=models.CASCADE,
        related_name="fields",
    )
    # `preset_key` is set when this field was dragged from PRESET_FIELDS.
    # It lets us recognise the email/phone fields anywhere in the codebase
    # without resorting to label matching — see Registration.from_form_data.
    preset_key = models.CharField(max_length=40, blank=True)
    label = models.CharField(max_length=160)
    field_type = models.CharField(max_length=20, choices=TYPE_CHOICES, default=TYPE_TEXT)
    required = models.BooleanField(default=False)
    help_text = models.CharField(max_length=240, blank=True)
    placeholder = models.CharField(max_length=120, blank=True)
    # For select/multi: one option per line.
    options = models.TextField(
        blank=True,
        help_text="One option per line. Used for single/multiple choice fields.",
    )
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["order", "id"]
        indexes = [models.Index(fields=["event", "order"])]

    def __str__(self):
        return f"{self.label} ({self.get_field_type_display()})"

    def options_list(self):
        return [o.strip() for o in self.options.splitlines() if o.strip()]

    def html_input_name(self):
        """Stable name used in <input name=...>. Always 'field_{pk}'."""
        return f"field_{self.pk}"


# ───────────────────── Registration ─────────────────────

class Registration(models.Model):
    """One row per (event, person). Tracks status from pending → checked-in."""

    STATUS_PENDING = "pending"
    STATUS_ACCEPTED = "accepted"
    STATUS_DECLINED = "declined"
    STATUS_CHECKED_IN = "checked_in"
    STATUS_CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (STATUS_PENDING,    "Pending review"),
        (STATUS_ACCEPTED,   "Accepted"),
        (STATUS_DECLINED,   "Declined"),
        (STATUS_CHECKED_IN, "Checked in"),
        (STATUS_CANCELLED,  "Cancelled"),
    ]

    event = models.ForeignKey(
        AttendanceEvent,
        on_delete=models.CASCADE,
        related_name="registrations",
    )
    # Captured from form regardless of whether they're a User. We rely on
    # email/phone for lookup at scan time, so they live on the row directly.
    full_name = models.CharField(max_length=160, blank=True)
    email = models.EmailField(blank=True, db_index=True)
    phone = models.CharField(max_length=40, blank=True, db_index=True)

    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=STATUS_PENDING)

    # `token` is the per-registration public identifier used in the
    # attendee's personal QR code. Different from the event-level QR
    # (which is the projector display at the venue).
    token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)

    is_walk_in = models.BooleanField(default=False)

    # Timestamps for the auditable lifecycle.
    registered_at = models.DateTimeField(auto_now_add=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    checked_in_at = models.DateTimeField(null=True, blank=True)

    # Optional link back to a Knock-Knock account if the person had one.
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL, null=True, blank=True,
        related_name="event_registrations",
    )

    class Meta:
        ordering = ["-registered_at"]
        indexes = [
            models.Index(fields=["event", "status"]),
            models.Index(fields=["event", "email"]),
            models.Index(fields=["event", "phone"]),
        ]
        constraints = [
            # An event can have at most one non-cancelled registration per
            # email. Cancelled rows are kept for audit and don't block re-reg.
            models.UniqueConstraint(
                fields=["event", "email"],
                condition=~models.Q(email="") & ~models.Q(status="cancelled"),
                name="uniq_event_email_active",
            ),
        ]

    def __str__(self):
        return f"{self.display_name()} → {self.event.title}"

    def display_name(self):
        return self.full_name or self.email or self.phone or f"Guest #{self.pk}"

    def is_seat_holding(self):
        """Does this registration occupy a capacity seat?"""
        return self.status in (self.STATUS_ACCEPTED, self.STATUS_CHECKED_IN)

    def can_check_in(self):
        if self.status == self.STATUS_CHECKED_IN:
            return False  # already in
        if self.status not in (self.STATUS_ACCEPTED,):
            return False  # not approved yet, or declined/cancelled
        return self.event.is_check_in_open()

    def mark_accepted(self, *, save=True):
        self.status = self.STATUS_ACCEPTED
        self.accepted_at = timezone.now()
        if save:
            self.save(update_fields=["status", "accepted_at"])

    def mark_checked_in(self, *, save=True):
        if self.status != self.STATUS_CHECKED_IN:
            self.status = self.STATUS_CHECKED_IN
            self.checked_in_at = timezone.now()
            if save:
                self.save(update_fields=["status", "checked_in_at"])

    def get_ticket_url(self):
        return reverse("attendance:ticket", kwargs={"token": str(self.token)})


# ───────────────────── RegistrationAnswer ─────────────────────

class RegistrationAnswer(models.Model):
    """Per-registration value for one EventField."""

    registration = models.ForeignKey(
        Registration, on_delete=models.CASCADE, related_name="answers",
    )
    field = models.ForeignKey(
        EventField, on_delete=models.CASCADE, related_name="answers",
    )
    value = models.TextField(blank=True)

    class Meta:
        unique_together = [("registration", "field")]

    def __str__(self):
        return f"{self.field.label}: {self.value[:40]}"


# ───────────────────── EventAnnouncement ─────────────────────

class EventAnnouncement(models.Model):
    """Organizer-broadcast message — agenda update, 'we're starting in 5'."""

    CHANNEL_EMAIL = "email"
    CHANNEL_PUSH = "push"   # WebSocket push to anyone watching their ticket
    CHANNEL_BOTH = "both"
    CHANNEL_CHOICES = [
        (CHANNEL_EMAIL, "Email"),
        (CHANNEL_PUSH,  "In-app push"),
        (CHANNEL_BOTH,  "Both"),
    ]

    event = models.ForeignKey(
        AttendanceEvent, on_delete=models.CASCADE, related_name="announcements",
    )
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
    )
    subject = models.CharField(max_length=200, blank=True)
    body = models.TextField()
    channel = models.CharField(max_length=8, choices=CHANNEL_CHOICES, default=CHANNEL_BOTH)
    # Optional: only send to specific statuses. Empty = everyone.
    target_statuses = models.CharField(max_length=120, blank=True,
                                       help_text="Comma-separated statuses, e.g. 'accepted,checked_in'.")
    sent_at = models.DateTimeField(auto_now_add=True)
    delivered_count = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["-sent_at"]

    def __str__(self):
        return f"{self.subject or self.body[:30]} → {self.event.title}"


# ───────────────────── Certificate ─────────────────────

class Certificate(models.Model):
    """Generated certificate for a checked-in attendee."""

    registration = models.OneToOneField(
        Registration, on_delete=models.CASCADE, related_name="certificate",
    )
    serial = models.CharField(max_length=20, unique=True, db_index=True)
    pdf_file = models.FileField(upload_to="events/certificates/", blank=True, null=True)
    generated_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if not self.serial:
            # 'KK-' + 12 base32-ish chars. Distinct from registration token
            # so we can print it on the certificate without exposing the URL.
            alphabet = string.ascii_uppercase + string.digits
            self.serial = "KK-" + "".join(secrets.choice(alphabet) for _ in range(12))
        super().save(*args, **kwargs)

    def __str__(self):
        return self.serial


# ───────────────────── Agenda days & items ─────────────────────

class AgendaDay(models.Model):
    """
    One day in a multi-day agenda.

    Single-day events still have exactly one AgendaDay row (created
    automatically the first time an item is added, or backfilled by
    the migration for legacy events). Multi-day events have one row
    per day — Day 1, Day 2, "Pre-conference Workshop", whatever the
    organiser wants.

    `date` is the calendar date the day's sessions occur on. Used by
    the "you are here" indicator on the live pages to anchor each
    session to the right wall-clock moment.

    `label` is the human-readable header shown above the day's
    sessions in every agenda style. If blank, no header is rendered,
    which keeps single-day agendas looking exactly the way they
    looked before this model existed.
    """

    event = models.ForeignKey(
        AttendanceEvent, on_delete=models.CASCADE, related_name="agenda_days",
    )
    date = models.DateField(
        help_text="Calendar date this day's sessions occur on.",
    )
    label = models.CharField(
        max_length=120, blank=True,
        help_text="Header shown above this day's sessions "
                  "(e.g. 'Day 1', 'Pre-conference workshop'). "
                  "Leave blank for no header — useful for single-day events.",
    )
    order = models.PositiveIntegerField(
        default=0,
        help_text="Display order. Days with the same order fall back to date.",
    )

    class Meta:
        ordering = ("order", "date", "id")

    def __str__(self):
        return self.label or self.date.isoformat()


class AgendaItem(models.Model):
    """
    One row in the structured agenda table.

    The free-text `AttendanceEvent.agenda` field still exists and still
    powers email rendering (where rich layout is unreliable). When the
    organiser fills in AgendaItem rows, the ticket and event pages will
    render those instead, styled by the event's chosen agenda template.

    Each item belongs to exactly one AgendaDay. The day's `date` plus
    the item's `start_time` gives the precise moment the session
    starts — used by the live "now" indicator.

    The `event` field is retained for cheap reverse-lookups (still
    used by exports, certificates, and the legacy `agenda_items`
    related-name on AttendanceEvent). It's kept in sync automatically
    in `save()` so callers don't have to set it twice.
    """

    STATUS_UPCOMING = "upcoming"
    STATUS_LIVE = "live"
    STATUS_DONE = "done"
    STATUS_CHOICES = [
        (STATUS_UPCOMING, "Upcoming"),
        (STATUS_LIVE, "Happening now"),
        (STATUS_DONE, "Done"),
    ]

    event = models.ForeignKey(
        AttendanceEvent, on_delete=models.CASCADE, related_name="agenda_items",
    )
    day = models.ForeignKey(
        AgendaDay, on_delete=models.CASCADE, related_name="items",
        # Nullable in the model to let the data migration backfill it
        # without a chicken-and-egg problem. After the migration runs,
        # the application layer (forms, views) never produces NULL.
        null=True, blank=True,
    )
    order = models.PositiveIntegerField(default=0)

    start_time = models.TimeField(
        help_text="Local start time on this day.",
    )
    end_time = models.TimeField(
        null=True, blank=True,
        help_text="Optional. Used to compute a duration label.",
    )

    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    speaker = models.CharField(
        max_length=160, blank=True,
        help_text="Speaker, facilitator, or owner — optional.",
    )
    track = models.CharField(
        max_length=80, blank=True,
        help_text="Optional track / room name (e.g. 'Main Hall', 'Workshop B').",
    )
    accent_colour = models.CharField(
        max_length=20, blank=True,
        help_text="Optional hex colour to override the template's default for this row.",
    )
    status = models.CharField(
        max_length=10, choices=STATUS_CHOICES, default=STATUS_UPCOMING,
    )

    class Meta:
        ordering = ("day__order", "day__date", "order", "start_time")

    def __str__(self):
        return f"{self.start_time}  {self.title}"

    def save(self, *args, **kwargs):
        # Keep `event` in sync with the chosen day. Callers can pass
        # only `day` and we'll resolve the event from it.
        if self.day_id and not self.event_id:
            self.event_id = self.day.event_id
        super().save(*args, **kwargs)

    @property
    def duration_label(self):
        """Human-readable duration like '45 min' or '1 h 30 min'."""
        if not (self.start_time and self.end_time):
            return ""
        s = self.start_time.hour * 60 + self.start_time.minute
        e = self.end_time.hour * 60 + self.end_time.minute
        mins = e - s
        if mins <= 0:
            return ""
        if mins < 60:
            return f"{mins} min"
        h, m = divmod(mins, 60)
        return f"{h} h" + (f" {m} min" if m else "")