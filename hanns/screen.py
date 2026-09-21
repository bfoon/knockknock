"""
hanns/screen.py — shared logic for the Hanns Big Screen.

Used by three callers that must agree with each other:

  * screen_views.py      — the HTTP endpoints (host, presenter, phone)
  * screen_consumers.py  — the big screen's own WebSocket
  * views.deck_control   — the phone controller, which accepts a
                           host-issued control code as well as the deck PIN
  * consumers.py         — the deck socket, same rule for controller_hello

Everything that mutates a screen calls push_state() afterwards, so the big
screen and the host's dashboard redraw from one authoritative snapshot
instead of each patching its own copy.
"""

import hashlib
import time

from django.core.cache import cache
from django.urls import reverse
from django.utils import timezone


# ── session / throttle keys ──────────────────────────────────────────
# Where a phone that came in through a HOST-ISSUED control code records
# that fact. Kept apart from views.CONTROL_SESSION_KEY on purpose: the two
# credentials die for different reasons (PIN rotated vs. share closed), and
# a phone needs to know which one it had to be sent to the right door.
SCREEN_CTRL_SESSION_KEY = "hanns_screen_ctrl"

# Wrong-code throttles. Six digits is a million combinations; eight tries
# per ten minutes per browser, and a coarser per-IP cap on top so clearing
# cookies does not reset the clock.
MAX_TRIES = 8
WINDOW_SECONDS = 10 * 60
IP_MAX_TRIES = 40


def screen_group(screen_id):
    return f"hanns_screen_{screen_id.hex if hasattr(screen_id, 'hex') else screen_id}"


def person_label(user):
    if not user:
        return "Someone"
    full = (user.get_full_name() or "").strip() if hasattr(user, "get_full_name") else ""
    return full or user.get_username() or getattr(user, "email", "") or "Someone"


# ── serialisation ────────────────────────────────────────────────────
def _age_label(dt):
    if not dt:
        return ""
    secs = max(0, int((timezone.now() - dt).total_seconds()))
    if secs < 45:
        return "just now"
    if secs < 3600:
        m = max(1, secs // 60)
        return f"{m} min ago"
    h = secs // 3600
    return f"{h} h ago"


def share_dict(share, *, include_control=True):
    deck = share.deck
    slides = list(deck.slides.all())
    return {
        "id": str(share.id),
        "title": deck.title,
        "sharer": share.sharer_name or person_label(share.shared_by),
        "note": share.note,
        "status": share.status,
        "status_label": share.get_status_display(),
        "slides": len(slides),
        "first": slides[0].as_dict() if slides else None,
        "created": share.created_at.isoformat() if share.created_at else "",
        "age": _age_label(share.created_at),
        "control_code": share.control_code if include_control else "",
        "frame_url": reverse("hanns:screen_frame", args=[share.screen.token, share.id]),
    }


def screen_state(screen):
    """The single snapshot every screen client renders from."""
    shares = list(screen.open_shares().order_by("created_at")) if screen.is_active else []
    return {
        "id": str(screen.id),
        "name": screen.name,
        "active": screen.is_active,
        "share_code": screen.share_code if screen.is_active else "",
        "show_code": screen.show_code_on_screen,
        "current": str(screen.current_share_id) if screen.current_share_id else None,
        "shares": [share_dict(s) for s in shares],
        "waiting": sum(1 for s in shares if s.status == s.STATUS_WAITING),
        "control_entry_url": reverse("hanns:screen_control_entry"),
    }


# ── realtime fan-out ─────────────────────────────────────────────────
def _send(group, message):
    """group_send from sync code. Never lets a channel-layer hiccup turn a
    successful HTTP action into a 500 — the clients also poll as a backstop."""
    try:
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer
        layer = get_channel_layer()
        if layer is None:
            return
        async_to_sync(layer.group_send)(group, message)
    except Exception:
        pass


def push_state(screen, notice=None):
    screen.refresh_from_db()
    payload = {"type": "screen_state", "state": screen_state(screen)}
    if notice:
        payload["notice"] = notice
    _send(screen_group(screen.id), {"type": "screen.event", "payload": payload})


def push_stopped(screen):
    _send(screen_group(screen.id), {
        "type": "screen.event",
        "payload": {"type": "screen_stopped", "name": screen.name},
    })


def revoke_share_controllers(shares):
    """Drop every phone controller that got in through these shares'
    control codes. Phones on the deck owner's own PIN are untouched."""
    by_deck = {}
    for s in shares:
        code = s.deck.code if getattr(s, "deck", None) else None
        if code:
            by_deck.setdefault(code, []).append(str(s.id))
    for deck_code, ids in by_deck.items():
        _send(f"hanns_{deck_code}", {
            "type": "screen.control_revoked", "shares": ids,
        })


# ── phone-controller grants (host-issued control code) ───────────────
def grant_share_control(request, share):
    store = dict(request.session.get(SCREEN_CTRL_SESSION_KEY) or {})
    store[share.deck.code] = {"share": str(share.id), "fp": share.control_fingerprint()}
    request.session[SCREEN_CTRL_SESSION_KEY] = store
    request.session.modified = True


def had_share_grant(request, deck):
    store = request.session.get(SCREEN_CTRL_SESSION_KEY) or {}
    return deck.code in store


def share_control_pin(request, deck):
    """The control code to hand the controller page, if this browser holds a
    still-valid host-issued grant for this deck. None otherwise.

    Valid means: the share is still open, the screen is still running, and
    the code has not been re-issued since this phone unlocked.
    """
    from .models import ScreenShare
    store = request.session.get(SCREEN_CTRL_SESSION_KEY) or {}
    rec = store.get(deck.code)
    if not rec:
        return None
    share = ScreenShare.objects.filter(
        pk=rec.get("share"), deck=deck,
        status__in=ScreenShare.OPEN_STATES, screen__is_active=True,
    ).exclude(control_code="").first()
    if not share or share.control_fingerprint() != rec.get("fp"):
        return None
    return share.control_code


def share_for_control_code(deck_code, code):
    """Socket-side check: which open share (if any) does this code unlock
    for this deck? Returns the share id as a string, or None."""
    from .models import ScreenShare
    code = (code or "").strip()
    if len(code) != 6 or not code.isdigit():
        return None
    share = ScreenShare.objects.filter(
        deck__code=deck_code, control_code=code,
        status__in=ScreenShare.OPEN_STATES, screen__is_active=True,
    ).first()
    return str(share.id) if share else None


# ── throttling ───────────────────────────────────────────────────────
def _client_ip(request):
    fwd = request.META.get("HTTP_X_FORWARDED_FOR", "")
    return (fwd.split(",")[0].strip() if fwd else request.META.get("REMOTE_ADDR", "")) or "?"


def throttle_check(request, bucket):
    """(tries_left, locked) for this browser + IP on a code-entry form."""
    rec = (request.session.get("hanns_screen_tries") or {}).get(bucket) or {}
    started, count = rec.get("at", 0), rec.get("n", 0)
    if not started or time.time() - started > WINDOW_SECONDS:
        count = 0
    ip_key = "hanns_scr_ip:" + hashlib.sha1(
        f"{bucket}:{_client_ip(request)}".encode()).hexdigest()
    ip_count = cache.get(ip_key, 0) or 0
    locked = count >= MAX_TRIES or ip_count >= IP_MAX_TRIES
    return max(0, MAX_TRIES - count), locked


def throttle_miss(request, bucket):
    store = dict(request.session.get("hanns_screen_tries") or {})
    rec = dict(store.get(bucket) or {})
    if not rec.get("at") or time.time() - rec["at"] > WINDOW_SECONDS:
        rec = {"n": 0, "at": time.time()}
    rec["n"] = rec.get("n", 0) + 1
    store[bucket] = rec
    request.session["hanns_screen_tries"] = store
    request.session.modified = True

    ip_key = "hanns_scr_ip:" + hashlib.sha1(
        f"{bucket}:{_client_ip(request)}".encode()).hexdigest()
    try:
        cache.add(ip_key, 0, WINDOW_SECONDS)
        cache.incr(ip_key)
    except Exception:
        pass
    return max(0, MAX_TRIES - rec["n"])


def throttle_clear(request, bucket):
    store = dict(request.session.get("hanns_screen_tries") or {})
    if store.pop(bucket, None) is not None:
        request.session["hanns_screen_tries"] = store
        request.session.modified = True
