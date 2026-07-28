"""
accounts/middleware.py — session activity, and per-app usage rollups.

"Last active 3 minutes ago" is what makes a device list useful, but a
write per request would be absurd. This throttles to one UPDATE per
session per SESSION_ACTIVITY_INTERVAL (default 5 minutes) by keeping the
last stamp in the session itself.

Install both AFTER AuthenticationMiddleware:

    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "accounts.middleware.SessionActivityMiddleware",
    "accounts.middleware.SiteUsageMiddleware",

SiteUsageMiddleware is what makes "which part of the platform gets used?"
answerable. It buckets traffic by URL namespace, so it covers every app
without any of them being modified — and stays correct for apps added
later. Turn it off with SITE_USAGE_TRACKING = False.
"""

from django.conf import settings
from django.utils import timezone


class SessionActivityMiddleware:

    def __init__(self, get_response):
        self.get_response = get_response
        self.interval = getattr(settings, "SESSION_ACTIVITY_INTERVAL", 300)

    def __call__(self, request):
        self._touch(request)
        return self.get_response(request)

    def _touch(self, request):
        user = getattr(request, "user", None)
        session = getattr(request, "session", None)
        if not user or not user.is_authenticated or session is None:
            return
        key = session.session_key
        if not key:
            return

        now = timezone.now()
        stamp = session.get("_seen_at")
        if stamp and (now.timestamp() - stamp) < self.interval:
            return

        from .models import UserSession
        updated = UserSession.objects.filter(session_key=key).update(last_seen=now)
        if not updated:
            # Session predates the index (or the row was pruned while the
            # cookie stayed valid) — adopt it so the device still shows up.
            UserSession.record(request, user)
        session["_seen_at"] = now.timestamp()


class SiteUsageMiddleware:
    """Counts requests and distinct users per app per day.

    Two different questions, two different costs:

    * hits — one cheap UPDATE per request (F expression, no read).
    * distinct users — one write per user per app per day. A marker in the
      session suppresses the rest, so the common case is zero queries.

    Skipped: the admin, static/media, unresolved URLs, and anything listed
    in SITE_USAGE_IGNORE.
    """

    DEFAULT_IGNORE = ("/admin/", "/static/", "/media/", "/favicon.ico")

    def __init__(self, get_response):
        self.get_response = get_response
        self.enabled = getattr(settings, "SITE_USAGE_TRACKING", True)
        self.ignore = tuple(getattr(settings, "SITE_USAGE_IGNORE",
                                    self.DEFAULT_IGNORE))

    def __call__(self, request):
        response = self.get_response(request)
        if self.enabled:
            try:
                self._record(request, response)
            except Exception:
                # Analytics must never take a page down.
                pass
        return response

    def _app_of(self, request):
        match = getattr(request, "resolver_match", None)
        if match is None:
            return None
        return (match.app_name or match.namespace
                or (match.func.__module__ or "").split(".")[0] or None)

    def _record(self, request, response):
        if request.method not in ("GET", "POST"):
            return
        if response.status_code >= 400:
            return
        if request.path.startswith(self.ignore):
            return

        app = self._app_of(request)
        if not app:
            return

        from django.db.models import F
        from django.utils import timezone as tz
        from .models import AppUsage, AppUsageUser

        day = tz.localdate()

        updated = AppUsage.objects.filter(app=app, day=day).update(hits=F("hits") + 1)
        if not updated:
            AppUsage.objects.get_or_create(app=app, day=day, defaults={"hits": 1})

        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return

        session = getattr(request, "session", None)
        if session is None:
            return
        marker = f"_used:{app}:{day.isoformat()}"
        if session.get(marker):
            return
        AppUsageUser.objects.get_or_create(app=app, day=day, user=user)
        session[marker] = True
