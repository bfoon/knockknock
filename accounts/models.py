"""
accounts/models.py — profile, per-device session tracking, usage rollups.

Django's session table has no user column, so there is no way to ask
"which devices is this account signed in on?" out of the box. UserSession
is that index: one row per session key, written when the user logs in and
removed when they log out or the session store expires.

Deleting a session is done through the configured SESSION_ENGINE rather
than by deleting a row from django_session directly, so this keeps working
if the project ever moves sessions to cache or Redis.

AppUsage / AppUsageUser answer "which part of the platform actually gets
used?". They key on the URL namespace (hanns, kura, boardly, polls…),
which means every app is covered — including ones added later — without
any app needing to know it is being measured, and without this module
importing a single one of their models.
"""

import re
from importlib import import_module

from django.conf import settings
from django.contrib.auth.signals import user_logged_in, user_logged_out
from django.db import models
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone


def _session_store():
    return import_module(settings.SESSION_ENGINE).SessionStore


def client_ip(request):
    """Best-effort client IP, honouring the proxy header this project sets."""
    fwd = (request.META.get("HTTP_X_FORWARDED_FOR") or "").split(",")[0].strip()
    return fwd or request.META.get("REMOTE_ADDR") or None


_BROWSERS = [
    ("Edge", r"Edg[eA]?/"),
    ("Opera", r"OPR/|Opera"),
    ("Samsung Internet", r"SamsungBrowser"),
    ("Chrome", r"Chrome/|CriOS/"),
    ("Firefox", r"Firefox/|FxiOS/"),
    ("Safari", r"Safari/"),
]
_SYSTEMS = [
    ("Android", r"Android"),
    ("iPhone", r"iPhone"),
    ("iPad", r"iPad"),
    ("Windows", r"Windows NT"),
    ("macOS", r"Mac OS X|Macintosh"),
    ("Linux", r"Linux|X11"),
]


def describe_agent(ua: str):
    """(kind, label) — e.g. ("mobile", "Chrome on Android").

    Deliberately small: enough to let somebody recognise their own phone in
    a list, not a full device-fingerprinting exercise.
    """
    ua = ua or ""
    if not ua.strip():
        return "other", "Unknown device"

    browser = next((n for n, pat in _BROWSERS if re.search(pat, ua)), None)
    system = next((n for n, pat in _SYSTEMS if re.search(pat, ua)), None)

    if re.search(r"iPad|Tablet", ua):
        kind = "tablet"
    elif re.search(r"Mobi|Android|iPhone", ua):
        kind = "mobile"
    elif system:
        kind = "desktop"
    else:
        kind = "other"

    if browser and system:
        label = f"{browser} on {system}"
    elif browser:
        label = browser
    elif system:
        label = system
    else:
        label = "Unknown device"
    return kind, label


class Profile(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="profile",
    )
    display_name = models.CharField(max_length=80, blank=True)
    logo = models.ImageField(upload_to="logos/", blank=True, null=True)
    brand_color = models.CharField(max_length=7, default="#7c3aed")
    bio = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    # Sign-in history. These are maintained by the user_logged_in receiver
    # below rather than read off User.last_login, because Django overwrites
    # last_login during login and the previous value is what people
    # actually want to see ("was that me on Tuesday?").
    last_login_at = models.DateTimeField(null=True, blank=True)
    previous_login_at = models.DateTimeField(null=True, blank=True)
    last_login_ip = models.GenericIPAddressField(null=True, blank=True)
    last_login_device = models.CharField(max_length=120, blank=True)

    def __str__(self):
        return self.display_name or self.user.username


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def create_profile(sender, instance, created, **kwargs):
    if created:
        Profile.objects.create(user=instance, display_name=instance.username)


class UserSessionQuerySet(models.QuerySet):

    def alive(self):
        """Drop rows whose session store has expired or been flushed.

        Sessions die silently — the store just stops returning them — so
        the index has to be reconciled on read. Cheap: people have a
        handful of sessions, not thousands.
        """
        Store = _session_store()
        dead = [s.pk for s in self if not Store().exists(s.session_key)]
        if dead:
            self.model.objects.filter(pk__in=dead).delete()
            return self.exclude(pk__in=dead)
        return self


class UserSession(models.Model):
    KIND_CHOICES = [
        ("desktop", "Desktop"),
        ("mobile", "Phone"),
        ("tablet", "Tablet"),
        ("other", "Other"),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="active_sessions",
    )
    session_key = models.CharField(max_length=40, unique=True, db_index=True)
    ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True)
    device = models.CharField(max_length=120, blank=True)
    kind = models.CharField(max_length=12, choices=KIND_CHOICES, default="other")
    created_at = models.DateTimeField(default=timezone.now)
    last_seen = models.DateTimeField(default=timezone.now)

    objects = UserSessionQuerySet.as_manager()

    class Meta:
        ordering = ["-last_seen"]

    def __str__(self):
        return f"{self.device or 'session'} ({self.user_id})"

    @property
    def icon(self):
        return {"mobile": "📱", "tablet": "📱", "desktop": "💻"}.get(self.kind, "🖥")

    @property
    def icon_class(self):
        """Bootstrap Icons class, to match the kk-* templates."""
        return {
            "mobile": "bi-phone",
            "tablet": "bi-tablet",
            "desktop": "bi-laptop",
        }.get(self.kind, "bi-display")

    def end(self):
        """Sign this device out and forget the row."""
        _session_store()(session_key=self.session_key).delete()
        self.delete()

    @classmethod
    def record(cls, request, user):
        """Index the session the user just logged in with."""
        session = getattr(request, "session", None)
        if session is None:
            return None
        if not session.session_key:
            session.save()
        ua = (request.META.get("HTTP_USER_AGENT") or "")[:600]
        kind, label = describe_agent(ua)
        now = timezone.now()
        obj, _ = cls.objects.update_or_create(
            session_key=session.session_key,
            defaults={
                "user": user, "ip": client_ip(request), "user_agent": ua,
                "device": label, "kind": kind,
                "created_at": now, "last_seen": now,
            },
        )
        return obj


@receiver(user_logged_in)
def on_login(sender, request, user, **kwargs):
    if request is None:
        return
    UserSession.record(request, user)

    profile, _ = Profile.objects.get_or_create(
        user=user, defaults={"display_name": user.username})
    ua = (request.META.get("HTTP_USER_AGENT") or "")
    _kind, label = describe_agent(ua)
    # Shift the stamp: what was "last" becomes "previous".
    Profile.objects.filter(pk=profile.pk).update(
        previous_login_at=profile.last_login_at,
        last_login_at=timezone.now(),
        last_login_ip=client_ip(request),
        last_login_device=label,
    )


@receiver(user_logged_out)
def on_logout(sender, request, user, **kwargs):
    session = getattr(request, "session", None)
    key = getattr(session, "session_key", None)
    if key:
        UserSession.objects.filter(session_key=key).delete()


# ── usage rollups ────────────────────────────────────────────────────

#: Display names for URL namespaces. Override in settings with
#: SITE_USAGE_LABELS = {...} to add or rename entries.
DEFAULT_APP_LABELS = {
    "accounts": "Accounts",
    "attendance": "Attendance",
    "boardly": "Boardly (sticky notes)",
    "cards": "Cards",
    "collaborations": "Collaborations",
    "community": "Community",
    "core": "Core / dashboard",
    "games": "Games",
    "hanns": "Hanns (presentations)",
    "icebreakers": "Icebreakers",
    "kura": "Kura (surveys)",
    "organizations": "Organizations",
    "polls": "Polls",
    "presentations": "Presentations",
    "quest_rpg": "Quest RPG",
    "subscriptions": "Subscriptions",
}


def app_label_for(app: str) -> str:
    from django.conf import settings as dj_settings
    labels = dict(DEFAULT_APP_LABELS)
    labels.update(getattr(dj_settings, "SITE_USAGE_LABELS", {}) or {})
    return labels.get(app, app.replace("_", " ").title())


class AppUsage(models.Model):
    """One row per app per day: raw request volume."""

    app = models.CharField(max_length=64, db_index=True)
    day = models.DateField(db_index=True)
    hits = models.PositiveIntegerField(default=0)

    class Meta:
        unique_together = [("app", "day")]
        ordering = ["-day", "-hits"]

    def __str__(self):
        return f"{self.app} {self.day}: {self.hits}"

    @property
    def label(self):
        return app_label_for(self.app)


class AppUsageUser(models.Model):
    """One row per (app, day, user): lets us count distinct users, not just
    requests. Written once per user per app per day — the middleware keeps a
    marker in the session so repeat visits cost nothing."""

    app = models.CharField(max_length=64, db_index=True)
    day = models.DateField(db_index=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name="app_usage")

    class Meta:
        unique_together = [("app", "day", "user")]
        ordering = ["-day"]

    def __str__(self):
        return f"{self.user_id} used {self.app} on {self.day}"
