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

Dual decks (CDJ booth)
----------------------
Deck A is the top level of the media dict (so the queue, the projector panel
and every older client keep working); deck B lives under `m["b"]` with the
same playback fields. Deck actions take `"deck": "a" | "b"` (default "a").
  mix         crossfader `xf` −1 (A) … +1 (B), channel faders `a` / `b` 0–100,
              `curve` "mix" (both full in the middle) or "cut" (scratch)
  cue_main    CDJ CUE: store the cue point;  cue_return: back to it, paused
  bpm         the track's own tempo (tapped in the booth); shown × rate
  sync        set this deck's rate so its BPM matches the other deck
  duration    reported once by a projector, for remaining time / needle search
  load_queued move a crate item onto a deck

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
DECKS = ("a", "b")
DECK_FIELDS = ("current", "playing", "position", "started_at", "rate", "seek_rev")
MIX_CURVES = ("mix", "cut")
# DJ booth effects, fanned out to the projectors as-is (never stored):
DJ_FX = ("scratch_start", "scratch", "scratch_end", "horn", "siren", "rewind", "brake", "pad", "silence")

# Drums & FX sampler: 16 pads. Built-in sounds are synthesized in the browser
# (hanns_dj_fx.js), so these ids are the whole contract; a pad can also hold a
# sound file the host uploaded for this screen (url under SAMPLE_DIR).
PAD_COUNT = 16
PAD_SOUNDS = (
    "kick", "snare", "clap", "hat", "openhat", "tom", "rim", "crash", "cowbell", "bass808",
    "gunshot", "laser", "explosion", "airhorn", "siren", "riser", "impact", "whoosh", "rewind", "applause",
)
DEFAULT_PADS = ("kick", "snare", "clap", "hat", "openhat", "tom", "rim", "crash",
                "gunshot", "laser", "explosion", "airhorn", "siren", "riser", "impact", "whoosh")
SAMPLE_DIR = "screenart/samples"
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
    b = dict(m.get("b") or {})
    b.setdefault("current", None)
    b.setdefault("playing", False)
    b.setdefault("position", 0)
    b.setdefault("rate", 1.0)
    b.setdefault("seek_rev", 0)
    m["b"] = b
    m["mix"] = dict({"xf": 0.0, "a": 100, "b": 100, "curve": "mix"}, **(m.get("mix") or {}))
    m["pads"] = _pads(m.get("pads"))
    m.setdefault("cut", False)
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
    out = {"type": "dj_fx", "kind": kind, "deck": "b" if str(data.get("deck") or "a").lower() == "b" else "a"}
    if kind == "scratch":
        v = data.get("v") if isinstance(data.get("v"), list) else []
        out["v"] = [round(max(-8.0, min(8.0, _num(x))), 3) for x in v[:64]]
        out["dt"] = int(max(10, min(100, _num(data.get("dt"), 30))))
    if kind == "scratch_end":
        out["position"] = round(max(0, _num(data.get("position"))), 2)
    if kind == "pad":
        i = int(_num(data.get("pad"), -1))
        if not 0 <= i < PAD_COUNT:
            raise ProgramError("Unknown pad.")
        out["pad"] = i
    return out


def _pads(stored):
    """16 pads, each {"sound": built-in id} or {"sound": "custom", "url", "name"}."""
    pads = []
    stored = stored if isinstance(stored, list) else []
    for i in range(PAD_COUNT):
        p = stored[i] if i < len(stored) and isinstance(stored[i], dict) else {}
        if p.get("sound") == "custom" and p.get("url"):
            pads.append({"sound": "custom", "url": str(p["url"]), "name": str(p.get("name") or "My sound")[:40]})
        elif p.get("sound") in PAD_SOUNDS:
            pads.append({"sound": p["sound"]})
        else:
            pads.append({"sound": DEFAULT_PADS[i]})
    return pads


def sample_prefix(screen_id):
    """The URL prefix of sounds uploaded for this screen (what pad_custom accepts)."""
    from django.core.files.storage import default_storage
    url = default_storage.url(f"{SAMPLE_DIR}/{screen_id}/")
    if not url.startswith(("http://", "https://", "//")):
        url = url if url.startswith("/") else "/" + url
    return url


def _pos(d, now):
    """Where a deck's needle is at `now` (ms), rate-aware."""
    if not d.get("current"):
        return 0
    if d.get("playing"):
        return d.get("position", 0) + max(0, now - d.get("started_at", now)) / 1000 * float(d.get("rate") or 1)
    return d.get("position", 0)


def _jump(d, position, now, playing=None):
    d.update(position=round(max(0, position), 3), started_at=now, seek_rev=int(d.get("seek_rev") or 0) + 1)
    if playing is not None:
        d["playing"] = playing


def _track(d, data):
    """The deck's current track with `cues` normalised (raises if the deck is empty)."""
    if not d.get("current"):
        raise ProgramError("Put a track on the deck first.")
    cur = dict(d["current"])
    cues = list((cur.get("cues") or [None] * CUE_SLOTS)[:CUE_SLOTS])
    cur["cues"] = cues + [None] * (CUE_SLOTS - len(cues))
    return cur


def media_action(screen_id, data):
    """Apply one host action.

    Library / deck A:  load / queue / next / ended / remove / mode / loop / chip / volume
    Any deck (`deck`): load / load_queued / play / pause / stop / seek / rate / cue_set / cue_clear /
                       cue_main / cue_return / bpm / sync / duration / ended
    Mixer:             mix"""
    m = media_for(screen_id)
    action = str(data.get("action") or "")
    now = _now_ms()
    dk = str(data.get("deck") or "a").lower()
    if dk not in DECKS:
        raise ProgramError("Unknown deck.")
    d = m if dk == "a" else m["b"]                       # the deck this action is about
    other = m["b"] if dk == "a" else m

    if action in ("play", "load", "load_queued"):
        m["cut"] = False                                  # music back on: "screen only" is over
    if action in ("load", "queue"):
        vid, start = parse_youtube(data.get("url"))
        item = {"id": vid, "title": video_title(vid), "start": start, "key": f"{vid}-{now}"}
        if data.get("mode") in MODES:
            m["mode"] = data["mode"]
        if action == "load" or (dk == "a" and not m.get("current")):
            _start(d, item, start)
            if not data.get("autoplay", dk == "a"):       # deck B (a CDJ) loads paused unless told
                d["playing"] = False
        else:
            if len(m["queue"]) >= MAX_QUEUE:
                raise ProgramError(f"The queue holds {MAX_QUEUE} videos — remove one first.")
            m["queue"].append(item)
    elif action == "load_queued":
        key = data.get("key")
        item = next((i for i in m["queue"] if i.get("key") == key), None)
        if not item:
            raise ProgramError("That track isn't in the crate any more.")
        m["queue"] = [i for i in m["queue"] if i.get("key") != key]
        _start(d, item, item.get("start", 0))
        if not data.get("autoplay", False):
            d["playing"] = False                          # a CDJ loads paused, on its cue
    elif action == "play":
        if not d.get("current"):
            if dk == "b" or not m["queue"]:
                raise ProgramError("Paste a YouTube link first." if dk == "a" else "Load a track on deck B first.")
            _start(m, m["queue"].pop(0), 0)
        elif not d.get("playing"):
            d.update(playing=True, started_at=now)
    elif action == "pause":
        if d.get("current") and d.get("playing"):
            d.update(position=_pos(d, now), playing=False)
    elif action == "stop":
        d.update(current=None, playing=False, position=0)
    elif action in ("next", "ended"):
        # "ended" comes from a projector: only act if it's about what's playing now
        if action == "ended" and (not d.get("current") or data.get("key") != d["current"].get("key")):
            return m
        if dk == "b":                                     # deck B: a CD player stops at the end
            if m.get("loop"):
                _start(d, d["current"], d["current"].get("start", 0))
            else:
                _jump(d, d["current"].get("cue", d["current"].get("start", 0)), now, playing=False)
        elif action == "ended" and m.get("loop") and not m["queue"]:
            _start(m, m["current"], m["current"].get("start", 0))
        elif m["queue"]:
            nxt = m["queue"].pop(0)
            if m.get("loop") and m.get("current"):
                m["queue"].append(m["current"])         # loop the whole queue
            _start(m, nxt, nxt.get("start", 0))
        else:
            m.update(current=None, playing=False, position=0)
    elif action == "seek":
        if d.get("current"):
            _jump(d, _num(data.get("position")), now)
    elif action == "rate":
        rate = round(min(RATE_MAX, max(RATE_MIN, _num(data.get("rate"), 1.0))), 3)
        d.update(position=_pos(d, now), started_at=now, rate=rate)      # rebase, then change speed
    elif action in ("cue_set", "cue_clear"):
        cur = _track(d, data)
        slot = int(_num(data.get("slot"), -1))
        if not 0 <= slot < CUE_SLOTS:
            raise ProgramError("Unknown cue.")
        cur["cues"][slot] = round(max(0, _num(data.get("position"), _pos(d, now))), 2) if action == "cue_set" else None
        d["current"] = cur
    elif action == "cue_main":
        cur = _track(d, data)
        cur["cue"] = round(max(0, _num(data.get("position"), _pos(d, now))), 2)
        d["current"] = cur
        if not d.get("playing"):
            _jump(d, cur["cue"], now)
    elif action == "cue_return":
        cur = _track(d, data)
        _jump(d, cur.get("cue", cur.get("start", 0)), now, playing=False)
    elif action == "bpm":
        cur = _track(d, data)
        bpm = _num(data.get("bpm"), 0)
        cur["bpm"] = round(bpm, 1) if 40 <= bpm <= 250 else None
        d["current"] = cur
    elif action == "sync":
        mine, theirs = (_track(d, data).get("bpm"), (other.get("current") or {}).get("bpm"))
        if not mine or not theirs:
            raise ProgramError("Tap the BPM on both decks first.")
        rate = round(min(RATE_MAX, max(RATE_MIN, theirs * float(other.get("rate") or 1) / mine)), 3)
        d.update(position=_pos(d, now), started_at=now, rate=rate)
    elif action == "duration":
        cur = d.get("current")
        dur = _num(data.get("duration"), 0)
        if cur and data.get("key") == cur.get("key") and 0 < dur < 24 * 3600 and not cur.get("duration"):
            d["current"] = dict(cur, duration=round(dur, 1))
        else:
            return m                                       # nothing new: don't save or push
    elif action == "cut":
        # SCREEN ONLY: both decks pause where they are (▶ picks up from there),
        # and the projector drops the video/audio straight away.
        for deck in (m, m["b"]):
            if deck.get("current") and deck.get("playing"):
                deck.update(position=_pos(deck, now), playing=False)
        m["cut"] = True
    elif action in ("pad_set", "pad_custom", "pad_reset"):
        i = int(_num(data.get("pad"), -1))
        if not 0 <= i < PAD_COUNT:
            raise ProgramError("Unknown pad.")
        pads = m["pads"]
        if action == "pad_reset":
            pads[i] = {"sound": DEFAULT_PADS[i]}
        elif action == "pad_set":
            if data.get("sound") not in PAD_SOUNDS:
                raise ProgramError("Unknown sound.")
            pads[i] = {"sound": data["sound"]}
        else:
            url = str(data.get("url") or "")
            if not url.startswith(sample_prefix(screen_id)) or ".." in url:
                raise ProgramError("Upload the sound for this screen first.")
            pads[i] = {"sound": "custom", "url": url, "name": " ".join(str(data.get("name") or "My sound").split())[:40]}
        m["pads"] = pads
    elif action == "mix":
        mix = m["mix"]
        if "xf" in data:
            mix["xf"] = round(max(-1.0, min(1.0, _num(data.get("xf"), mix["xf"]))), 3)
        for ch in DECKS:
            if ch in data:
                mix[ch] = int(max(0, min(100, _num(data.get(ch), mix[ch]))))
        if data.get("curve") in MIX_CURVES:
            mix["curve"] = data["curve"]
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
