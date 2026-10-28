"""Big Screen · the paired slide remote.

One phone or tablet can be paired with a big screen. While the screen's
remote LOCK is on, that device is the only thing that can drive the slides
of whatever deck is on that screen: phones on the deck PIN or a Big Screen
control code, and presenter laptops, are refused and snapped back to the
slide the room is on. Lock off (or nothing paired) → everything works the
way it always has.

Pairing, like Bluetooth:
  1. the phone opens /hanns/screen/remote/, types the screen's share code and
     a name ("Fatou's iPhone") → the server makes a secret, keeps only its
     SHA-256 hash, and gives the phone a match symbol — e.g. 🦊 Amber Fox
  2. the same symbol shows on the projector lobby and on the control board,
     where the host taps Approve (or Deny)
  3. approved → the lock switches on; the phone opens the full controller
     (notes, reveals, zoom, actors) for the deck on the screen and follows
     the screen when the deck changes

Stored in screenart.ScreenStyle.settings["remote"] — no new table:
  {"lock": bool,
   "device":  {"id", "hash", "name", "match", "since"} | None,
   "pending": [{"id", "hash", "name", "match", "at"}],     (≤ 3, 10 min)
   "denied":  [hash, …]}                                   (last 10)
The phone's cookie holds "<screen id>.<secret>"; only `public_state` goes to
clients, and it never includes a hash.
"""

import hashlib
import secrets
import time

from django.utils import timezone

COOKIE = "kk_remote"
PENDING_TTL_MS = 10 * 60 * 1000
MAX_PENDING = 3

ANIMALS = [("🦊", "Fox"), ("🐙", "Octopus"), ("🦉", "Owl"), ("🐢", "Turtle"), ("🦁", "Lion"), ("🐬", "Dolphin"),
           ("🦜", "Parrot"), ("🐝", "Bee"), ("🦋", "Butterfly"), ("🐘", "Elephant"), ("🦒", "Giraffe"), ("🐼", "Panda")]
COLOURS = [("Amber", "#f5a524"), ("Coral", "#fb7185"), ("Teal", "#2dd4bf"), ("Violet", "#a78bfa"),
           ("Lime", "#a3e635"), ("Sky", "#38bdf8")]


class RemoteError(Exception):
    pass


def _now_ms():
    return int(time.time() * 1000)


def _hash(secret):
    return hashlib.sha256(str(secret or "").encode()).hexdigest()


def _style(screen_id, create=False):
    from screenart.models import ScreenStyle
    if create:
        style, _ = ScreenStyle.objects.get_or_create(screen_id=screen_id, defaults={"settings": {}})
        return style
    return ScreenStyle.objects.filter(screen_id=screen_id).first()


def _load(screen_id):
    style = _style(screen_id)
    r = dict(((style.settings or {}).get("remote") or {}) if style else {})
    r.setdefault("lock", False)
    r.setdefault("device", None)
    r.setdefault("denied", [])
    now = _now_ms()
    r["pending"] = [p for p in (r.get("pending") or []) if now - int(p.get("at") or 0) < PENDING_TTL_MS]
    return r


def _save(screen_id, r):
    style = _style(screen_id, create=True)
    style.settings = dict(style.settings or {}, remote=r)
    style.save(update_fields=["settings", "updated_at"])


def _match(taken):
    """A symbol nobody else on this screen is showing right now."""
    for _ in range(40):
        a, c = secrets.choice(ANIMALS), secrets.choice(COLOURS)
        m = {"emoji": a[0], "word": f"{c[0]} {a[1]}", "color": c[1]}
        if m["word"] not in taken:
            return m
    return m


# ── reading ──────────────────────────────────────────────────────────
def public_state(screen_id):
    """What the control board and projector see (no hashes)."""
    r = _load(screen_id)
    d = r["device"]
    return {
        "lock": bool(r["lock"] and d),
        "device": {"name": d["name"], "match": d["match"], "since": d.get("since")} if d else None,
        "pending": [{"id": p["id"], "name": p["name"], "match": p["match"]} for p in r["pending"]],
    }


def parse_cookie(value):
    """'<screen id>.<secret>' → (screen_id, secret) or (None, None)."""
    sid, _, secret = str(value or "").partition(".")
    return (sid, secret) if sid and len(secret) >= 32 else (None, None)


def status(screen_id, secret):
    """Where this phone stands with the screen: paired / pending / denied / unpaired."""
    r, h = _load(screen_id), _hash(secret)
    d = r["device"]
    if d and secrets.compare_digest(d["hash"], h):
        return {"state": "paired", "name": d["name"], "match": d["match"], "lock": bool(r["lock"])}
    for p in r["pending"]:
        if secrets.compare_digest(p["hash"], h):
            return {"state": "pending", "name": p["name"], "match": p["match"]}
    if h in r["denied"]:
        return {"state": "denied"}
    return {"state": "unpaired"}


def device_ok(screen_id, secret):
    d = _load(screen_id)["device"]
    return bool(d and secret and secrets.compare_digest(d["hash"], _hash(secret)))


def is_locked(screen_id):
    r = _load(screen_id)
    return bool(r["lock"] and r["device"])


# ── the phone ────────────────────────────────────────────────────────
def request_pair(screen_id, name, secret=None):
    """Ask to pair. Re-asking from the same phone replaces its old request."""
    r = _load(screen_id)
    name = " ".join(str(name or "").split())[:40] or "Phone"
    secret = secret if secret and len(secret) >= 32 else secrets.token_urlsafe(32)
    h = _hash(secret)
    r["pending"] = [p for p in r["pending"] if p["hash"] != h]
    if len(r["pending"]) >= MAX_PENDING:
        raise RemoteError("A few phones are already waiting — ask the host to answer them first.")
    taken = {p["match"]["word"] for p in r["pending"]}
    req = {"id": "r" + secrets.token_hex(6), "hash": h, "name": name, "match": _match(taken), "at": _now_ms()}
    r["pending"].append(req)
    r["denied"] = [x for x in r["denied"] if x != h]
    _save(screen_id, r)
    return secret, req


def forget(screen_id, secret):
    """The phone lets go: drops its request, or unpairs itself."""
    r, h = _load(screen_id), _hash(secret)
    r["pending"] = [p for p in r["pending"] if p["hash"] != h]
    changed = False
    if r["device"] and r["device"]["hash"] == h:
        r["device"], r["lock"], changed = None, False, True
    _save(screen_id, r)
    return changed


# ── the host ─────────────────────────────────────────────────────────
def host_action(screen_id, data):
    """approve / deny a request, unpair the device, lock on/off.
    Returns True when the lock picture changed (live controllers must hear)."""
    r = _load(screen_id)
    action = str(data.get("action") or "")
    before = (bool(r["lock"] and r["device"]), (r["device"] or {}).get("hash"))
    if action in ("approve", "deny"):
        req = next((p for p in r["pending"] if p["id"] == data.get("id")), None)
        if not req:
            raise RemoteError("That request has expired — ask the phone to try again.")
        r["pending"] = [p for p in r["pending"] if p["id"] != req["id"]]
        if action == "approve":
            # one remote per screen: a new approval replaces the old phone
            r["device"] = {"id": "d" + secrets.token_hex(6), "hash": req["hash"], "name": req["name"],
                           "match": req["match"], "since": timezone.now().isoformat()}
            r["lock"] = True
        else:
            r["denied"] = (r["denied"] + [req["hash"]])[-10:]
    elif action == "unpair":
        r["device"], r["lock"] = None, False
    elif action == "lock":
        if data.get("lock") and not r["device"]:
            raise RemoteError("Pair a phone first.")
        r["lock"] = bool(data.get("lock"))
    else:
        raise RemoteError("Unknown action.")
    _save(screen_id, r)
    return before != (bool(r["lock"] and r["device"]), (r["device"] or {}).get("hash"))


# ── who may drive a deck ─────────────────────────────────────────────
def locks_for_deck(code):
    """Active screens showing deck `code` right now whose remote lock is on.
    → {screen_id(str): screen name}"""
    from .models import ScreenShare
    out = {}
    live = (ScreenShare.objects.select_related("screen")
            .filter(deck__code=str(code).upper(), status=ScreenShare.STATUS_LIVE, screen__is_active=True))
    for share in live:
        s = share.screen
        if s.current_share_id == share.id and is_locked(s.id):
            out[str(s.id)] = s.name
    return out


def remote_screen_for(code, secret):
    """The screen this phone is the remote of, if that screen shows deck `code`."""
    from .models import ScreenShare
    live = (ScreenShare.objects.select_related("screen")
            .filter(deck__code=str(code).upper(), status=ScreenShare.STATUS_LIVE, screen__is_active=True))
    for share in live:
        s = share.screen
        if s.current_share_id == share.id and device_ok(s.id, secret):
            return str(s.id)
    return None


def frame_screen_for(code, token, share_id):
    """The big screen whose own embedded stage this is (token + live share)."""
    from .models import ScreenShare
    if not token or not share_id:
        return None
    try:
        share = ScreenShare.objects.select_related("screen").get(
            pk=share_id, deck__code=str(code).upper(), status=ScreenShare.STATUS_LIVE,
            screen__token=token, screen__is_active=True)
    except Exception:
        return None
    return str(share.screen_id)


def deck_on(screen):
    """The deck on this screen now: (code, title) or (None, None)."""
    share = screen.current_share if screen.current_share_id else None
    if share and share.status == share.STATUS_LIVE:
        return share.deck.code, share.deck.title
    return None, None
