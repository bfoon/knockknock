"""Small fixed-window rate limiter over the Django cache.

Used to stop `/join/` being a code-guessing oracle. Fixed windows are less
precise than a sliding log, but they need one cache key and no storage, and
"roughly N per minute" is all this needs to be.

If you are running more than one web process, point CACHES at Redis or
Memcached — LocMemCache is per-process and the limit becomes per-process.
"""

import time

from django.core.cache import cache


def _bucket(scope, key, window):
    return f"chalk:rl:{scope}:{key}:{int(time.time() // window)}"


def hit(scope, key, limit, window):
    """Record one attempt. Returns True if it is within the limit.

    `scope` groups the counter (e.g. "join-ip"), `key` identifies the actor,
    `limit` is the number of attempts allowed per `window` seconds.
    """
    name = _bucket(scope, key, window)
    try:
        cache.add(name, 0, window + 10)
        count = cache.incr(name)
    except ValueError:
        # The key expired between add and incr. Treat as the first hit.
        cache.set(name, 1, window + 10)
        count = 1
    return count <= limit


def peek(scope, key, window):
    """Current count without recording an attempt."""
    return cache.get(_bucket(scope, key, window), 0)


def client_ip(request):
    """Best-effort client address.

    Only trusts X-Forwarded-For when settings.CHALK_TRUST_PROXY is on —
    otherwise anyone can spoof the header and walk straight past the limit.
    """
    from django.conf import settings

    if getattr(settings, "CHALK_TRUST_PROXY", False):
        forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "") or "unknown"
