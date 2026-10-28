"""What else the big screen can run from the lobby: YouTube and your event.

Music & video (YouTube)
-----------------------
The host pastes a YouTube link and plays it as **video** (full screen on the
projector) or **audio only** (the sound plays behind whatever is showing —
lobby, event background, a poll). A small queue lets breaks run on their
own: when a track ends the projector says so and the next one starts.
The projector keeps itself in sync from `started_at` + `position` (+ `rate`),
so every open copy of the screen plays the same moment.

DJ booth (turntable)
--------------------
  rate      pitch fader / 33-45: YouTube playback speed, 0.5–2.0. Position
            maths is rate-aware, so a pitched track stays in sync.
  seek      also bumps `seek_rev`, so projectors jump even for a small move
            (a scratch release, a hot cue) instead of waiting for 4 s of drift.
  cue_set   store hot cue 0–3 on the current track (`current.cues`);
  cue_clear a cue is played with a plain seek.
Scratches and FX pads don't touch the database at all: see `DJ_FX`.

Event (Attendance app)
----------------------
The host picks one of the screen owner's Attendance events and shows:
  register  big QR to the public registration page + live registered count
  checkin   QR to the public check-in page + live checked-in count
            (+ optional "Welcome, <first name>!" for new arrivals — off by default)
  agenda    the day's sessions with Now / Up next, in the event's time zone

Stored in the screen's ScreenStyle.settings under "media" / "event" — no new
table, no migration.
"""

import json
import re
import time
import urllib.parse
import urllib.request

from .models import ScreenStyle

YT_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
MAX_QUEUE = 20
MODES = ("video", "audio")
RATE_MIN, RATE_MAX = 0.5, 2.0
CUE_SLOTS = 4
# DJ booth effects, fanned out to the projectors as-is (never stored):
DJ_FX = ("scratch_start", "scratch", "scratch_end", "horn", "siren", "rewind", "brake")
VIEWS = ("off", "register", "checkin", "agenda")


class ProgramError(ValueError):
    pass


def _now_ms():
    return int(time.time() * 1000)


# ───────────────────────────── YouTube ─────────────────────────────

def parse_youtube(url):
    """(video_id, start_seconds) from any common YouTube link, else ProgramError."""
    raw = str(url or "").strip()
    if YT_ID.match(raw):
        return raw, 0
    if not re.match(r"^https?://", raw):
        raw = "https://" + raw
    try:
        u = urllib.parse.urlparse(raw)
    except ValueError:
        raise ProgramError("That doesn't look like a YouTube link.")
    host = (u.hostname or "").lower()
    q = urllib.parse.parse_qs(u.query)
    vid = None
    if host in ("youtu.be", "www.youtu.be"):
        vid = u.path.strip("/").split("/")[0]
    elif host.endswith("youtube.com") or host.endswith("youtube-nocookie.com"):
        if u.path == "/watch":
            vid = (q.get("v") or [None])[0]
        else:
            m = re.match(r"^/(embed|shorts|live|v)/([^/?#]+)", u.path)
            if m:
                vid = m.group(2)
    if not vid or not YT_ID.match(vid):
        raise ProgramError("That doesn't look like a YouTube video link — copy it from the Share button on YouTube.")
    start = 0
    t = (q.get("t") or q.get("start") or ["0"])[0]
    m = re.match(r"^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$", str(t))
    if m:
        start = int(m.group(1) or 0) * 3600 + int(m.group(2) or 0) * 60 + int(m.group(3) or 0)
    return vid, start


def video_title(vid):
    """Title from YouTube's public oEmbed endpoint; never blocks the screen for long."""
    try:
        url = "https://www.youtube.com/oembed?format=json&url=" + urllib.parse.quote(f"https://www.youtube.com/watch?v={vid}")
        with urllib.request.urlopen(url, timeout=3) as r:
            return str(json.loads(r.read().decode("utf-8")).get("title") or "")[:160] or "YouTube video"
    except Exception:
        return "YouTube video"


def _style(screen_id):
    style, _ = ScreenStyle.objects.get_or_create(screen_id=screen_id, defaults={"settings": {}})
    return style


def media_for(screen_id):
    style = ScreenStyle.objects.filter(screen_id=screen_id).first()
    m = dict((style.settings or {}).get("media") or {}) if style else {}
    m.setdefault("queue", [])
    m.setdefault("mode", "audio")
    m.setdefault("volume", 80)
    m.setdefault("loop", False)
    m.setdefault("chip", True)
    m.setdefault("playing", False)
    m.setdefault("rate", 1.0)
    m.setdefault("seek_rev", 0)
    m["server_now"] = _now_ms()          # lets projectors correct for their own clock
    return m


def _save_media(screen_id, m):
    m = {k: v for k, v in m.items() if k != "server_now"}
    style = _style(screen_id)
    style.settings = dict(style.settings or {}, media=m)
    style.save(update_fields=["settings", "updated_at"])
    return m


def _start(m, item, position=0):
    m.update(current=item, playing=True, position=max(0, int(position)), started_at=_now_ms(),
             seek_rev=int(m.get("seek_rev") or 0) + 1)


def _num(v, default=0.0):
    """A finite float from client JSON, else `default`."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    return f if f == f and f not in (float("inf"), float("-inf")) else default


def dj_fx(data):
    """Validate one DJ booth effect for the projectors. Returns the payload to fan out.

    scratch: `v` = up to 64 platter speeds (1.0 = normal play, negative = backwards),
    one every `dt` ms; scratch_end carries `position`, where the needle lands."""
    kind = str(data.get("kind") or "")
    if kind not in DJ_FX:
        raise ProgramError("Unknown effect.")
    out = {"type": "dj_fx", "kind": kind}
    if kind == "scratch":
        v = data.get("v") if isinstance(data.get("v"), list) else []
        out["v"] = [round(max(-8.0, min(8.0, _num(x))), 3) for x in v[:64]]
        out["dt"] = int(max(10, min(100, _num(data.get("dt"), 30))))
    if kind == "scratch_end":
        out["position"] = round(max(0, _num(data.get("position"))), 2)
    return out


def media_action(screen_id, data):
    """Apply one host action: load / queue / play / pause / stop / next / seek / volume / mode / loop / chip / remove / ended
    / rate / cue_set / cue_clear."""
    m = media_for(screen_id)
    action = str(data.get("action") or "")
    now = _now_ms()

    def pos_now():
        if not m.get("current"):
            return 0
        if m.get("playing"):
            return m.get("position", 0) + max(0, now - m.get("started_at", now)) / 1000 * float(m.get("rate") or 1)
        return m.get("position", 0)

    if action in ("load", "queue"):
        vid, start = parse_youtube(data.get("url"))
        item = {"id": vid, "title": video_title(vid), "start": start, "key": f"{vid}-{now}"}
        if data.get("mode") in MODES:
            m["mode"] = data["mode"]
        if action == "load" or not m.get("current"):
            _start(m, item, start)
        else:
            if len(m["queue"]) >= MAX_QUEUE:
                raise ProgramError(f"The queue holds {MAX_QUEUE} videos — remove one first.")
            m["queue"].append(item)
    elif action == "play":
        if not m.get("current"):
            if not m["queue"]:
                raise ProgramError("Paste a YouTube link first.")
            _start(m, m["queue"].pop(0), 0)
        elif not m.get("playing"):
            m.update(playing=True, started_at=now)
    elif action == "pause":
        if m.get("current") and m.get("playing"):
            m.update(position=pos_now(), playing=False)
    elif action == "stop":
        m.update(current=None, playing=False, position=0)
    elif action in ("next", "ended"):
        # "ended" comes from a projector: only act if it's about what's playing now
        if action == "ended" and (not m.get("current") or data.get("key") != m["current"].get("key")):
            return m
        if action == "ended" and m.get("loop") and not m["queue"]:
            _start(m, m["current"], m["current"].get("start", 0))
        elif m["queue"]:
            nxt = m["queue"].pop(0)
            if m.get("loop") and m.get("current"):
                m["queue"].append(m["current"])         # loop the whole queue
            _start(m, nxt, nxt.get("start", 0))
        else:
            m.update(current=None, playing=False, position=0)
    elif action == "seek":
        if m.get("current"):
            m.update(position=max(0, _num(data.get("position"))), started_at=now,
                     seek_rev=int(m.get("seek_rev") or 0) + 1)
    elif action == "rate":
        rate = round(min(RATE_MAX, max(RATE_MIN, _num(data.get("rate"), 1.0))), 3)
        m.update(position=pos_now(), started_at=now, rate=rate)      # rebase, then change speed
    elif action in ("cue_set", "cue_clear"):
        if not m.get("current"):
            raise ProgramError("Put a track on the deck first.")
        slot = int(_num(data.get("slot"), -1))
        if not 0 <= slot < CUE_SLOTS:
            raise ProgramError("Unknown cue.")
        cues = list((m["current"].get("cues") or [None] * CUE_SLOTS)[:CUE_SLOTS])
        cues += [None] * (CUE_SLOTS - len(cues))
        cues[slot] = round(max(0, _num(data.get("position"), pos_now())), 2) if action == "cue_set" else None
        m["current"] = dict(m["current"], cues=cues)
    elif action == "volume":
        m["volume"] = max(0, min(100, int(data.get("volume") or 0)))
    elif action == "mode":
        if data.get("mode") in MODES:
            m["mode"] = data["mode"]
    elif action == "loop":
        m["loop"] = bool(data.get("loop"))
    elif action == "chip":
        m["chip"] = bool(data.get("chip"))
    elif action == "remove":
        key = data.get("key")
        m["queue"] = [i for i in m["queue"] if i.get("key") != key]
    else:
        raise ProgramError("Unknown action.")
    return _save_media(screen_id, m)


# ───────────────────────────── Attendance ─────────────────────────────

def event_for(screen_id):
    style = ScreenStyle.objects.filter(screen_id=screen_id).first()
    e = dict((style.settings or {}).get("event") or {}) if style else {}
    e.setdefault("id", None)
    e.setdefault("view", "off")
    e.setdefault("welcome", False)
    return e


def owner_events(screen):
    from attendance.models import AttendanceEvent
    rows = AttendanceEvent.objects.filter(owner_id=screen.owner_id).order_by("-starts_at")[:40]
    return [{"id": ev.pk, "title": ev.title, "starts": ev.starts_at.isoformat(), "status": ev.status} for ev in rows]


def set_event(screen, data):
    from attendance.models import AttendanceEvent
    e = event_for(screen.id)
    if "id" in data:
        eid = data.get("id")
        if eid in (None, "", 0):
            e.update(id=None, view="off")
        elif AttendanceEvent.objects.filter(pk=eid, owner_id=screen.owner_id).exists():
            e["id"] = int(eid)
        else:
            raise ProgramError("That event isn't one of this screen owner's events.")
    if data.get("view") in VIEWS:
        if data["view"] != "off" and not e.get("id"):
            raise ProgramError("Pick an event first.")
        e["view"] = data["view"]
    if "welcome" in data:
        e["welcome"] = bool(data.get("welcome"))
    style = _style(screen.id)
    style.settings = dict(style.settings or {}, event=e)
    style.save(update_fields=["settings", "updated_at"])
    return e


def event_data(screen, request=None):
    """Everything the projector draws for the chosen event (fetched, not pushed)."""
    from django.urls import reverse
    from django.utils import timezone as djtz
    from attendance.models import AttendanceEvent, Registration
    import zoneinfo

    e = event_for(screen.id)
    ev = AttendanceEvent.objects.filter(pk=e.get("id"), owner_id=screen.owner_id).first() if e.get("id") else None
    if not ev:
        return None
    absu = (lambda p: request.build_absolute_uri(p)) if request else (lambda p: p)
    regs = ev.registrations.exclude(status__in=[Registration.STATUS_DECLINED, Registration.STATUS_CANCELLED])
    checked = regs.filter(checked_in_at__isnull=False)
    try:
        tz = zoneinfo.ZoneInfo(ev.timezone_name or "UTC")
    except Exception:
        tz = zoneinfo.ZoneInfo("UTC")
    out = {
        "id": ev.pk, "title": ev.title, "location": ev.location, "view": e["view"],
        "register_url": absu(reverse("attendance:public_register", args=[ev.public_token])),
        "checkin_url": absu(reverse("attendance:public_check_in", args=[ev.public_token])),
        "qr_url": reverse("attendance:public_qr", args=[ev.public_token]),
        "registered": regs.count(), "checked_in": checked.count(), "capacity": ev.capacity or None,
        "tz": str(tz), "now": djtz.now().astimezone(tz).isoformat(),
        "starts": ev.starts_at.astimezone(tz).isoformat(), "ends": ev.ends_at.astimezone(tz).isoformat(),
    }
    if e.get("welcome"):
        # first names only, newest first — never surnames or contact details
        out["arrivals"] = [{"name": (r.full_name or "").split()[0][:30], "at": r.checked_in_at.isoformat()}
                           for r in checked.order_by("-checked_in_at")[:8] if (r.full_name or "").strip()]
    days = []
    for d in ev.agenda_days.all() if hasattr(ev, "agenda_days") else []:
        items = [{"start": i.start_time.strftime("%H:%M") if i.start_time else "", "end": i.end_time.strftime("%H:%M") if i.end_time else "",
                  "title": i.title, "speaker": i.speaker, "track": i.track, "colour": i.accent_colour}
                 for i in d.items.all().order_by("order", "start_time")]
        days.append({"date": d.date.isoformat() if d.date else "", "label": d.label, "items": items})
    if not days:
        loose = ev.agenda_items.filter(day__isnull=True).order_by("order", "start_time") if hasattr(ev, "agenda_items") else []
        items = [{"start": i.start_time.strftime("%H:%M") if i.start_time else "", "end": i.end_time.strftime("%H:%M") if i.end_time else "",
                  "title": i.title, "speaker": i.speaker, "track": i.track, "colour": i.accent_colour} for i in loose]
        if items:
            days.append({"date": ev.starts_at.astimezone(tz).date().isoformat(), "label": "", "items": items})
    out["agenda"] = days
    return out
