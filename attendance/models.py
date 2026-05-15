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
"""

import secrets
import string
import uuid
from datetime import timedelta

from django.conf import settings
from django.db import models
from django.urls import reverse
from django.utils import timezone


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
        help_text="Markdown or plain text. Shown to attendees and used in emails.",
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


