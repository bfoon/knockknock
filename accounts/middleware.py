"""
accounts/middleware.py — keeps UserSession.last_seen meaningful.

"Last active 3 minutes ago" is what makes a device list useful, but a
write per request would be absurd. This throttles to one UPDATE per
session per SESSION_ACTIVITY_INTERVAL (default 5 minutes) by keeping the
last stamp in the session itself.

Install AFTER AuthenticationMiddleware:

    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "accounts.middleware.SessionActivityMiddleware",
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
