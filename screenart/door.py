"""Door screen — the welcome & event-information display outside a room.

A Big Screen can hand out a separate, read-only link for the TVs by the door. That page shows ONLY:

    • the event background (same images, slideshow, dim and slow zoom as the big screen)
    • the caption, and the "Back at HH:MM" countdown when one is set
    • the time and date (in the event's time zone when an event is linked)
    • the agenda — Now / Up next / later today — when an Attendance event is linked
    • an animated welcome host (static/screenart/js/door_greeter.js)

It never shows the share code, decks, check-in names, registration links or any control, so the link can sit
on any screen in a corridor. It has its own token (not the projector's, which is a host credential), the host
can switch it off or replace it at any time, and it is stored in the screen's ScreenStyle settings under
"door" — no migration. ScreenStyle.merged() only passes the backdrop keys on, so the door token never reaches
the big screen's live snapshot.
"""

import re
import secrets

from .models import ScreenStyle

FIGURES = ("woman", "man")
OUTFITS = ("official", "casual")
STYLES = ("animated", "robot")
SIDES = ("left", "right")
EVERY = (4, 6, 8, 10, 15, 20)
MAX_LINES = 6

DEFAULT_GREETER = {
    "on": True, "figure": "woman", "outfit": "official", "style": "animated", "skin": 2,
    "side": "left", "every": 6, "sign": True,
    "lines": ["Welcome!", "Dalal ak jàmm", "I bisimila"],
    "way": "Come in — this way",
}
DEFAULT_DOOR = {"on": False, "token": "", "agenda": True, "clock": True, "caption": True, "title": "", "greeter": DEFAULT_GREETER}

TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{16,64}$")


class DoorError(ValueError):
    pass


def _style(screen_id):
    style, _ = ScreenStyle.objects.get_or_create(screen_id=screen_id, defaults={"settings": {}})
    return style


def door_for(screen_id):
    """The screen's door settings, filled with defaults."""
    style = ScreenStyle.objects.filter(screen_id=screen_id).first()
    raw = dict(((style.settings or {}).get("door") or {}) if style else {})
    out = dict(DEFAULT_DOOR, **{k: v for k, v in raw.items() if k in DEFAULT_DOOR})
    out["greeter"] = dict(DEFAULT_GREETER, **{k: v for k, v in (raw.get("greeter") or {}).items() if k in DEFAULT_GREETER})
    return out


def _save(screen_id, door):
    style = _style(screen_id)
    style.settings = dict(style.settings or {}, door=door)
    style.save(update_fields=["settings", "updated_at"])
    return door


def _clean_greeter(data, current):
    g = dict(current)
    if not isinstance(data, dict):
        return g
    if "on" in data:
        g["on"] = bool(data["on"])
    for key, allowed in (("figure", FIGURES), ("outfit", OUTFITS), ("style", STYLES), ("side", SIDES)):
        if data.get(key) in allowed:
            g[key] = data[key]
    if "skin" in data:
        try:
            g["skin"] = max(1, min(3, int(data["skin"])))
        except (TypeError, ValueError):
            pass
    if "every" in data:
        try:
            v = int(data["every"])
            if v in EVERY:
                g["every"] = v
        except (TypeError, ValueError):
            pass
    if "sign" in data:
        g["sign"] = bool(data["sign"])
    if "lines" in data:
        raw = data["lines"]
        if isinstance(raw, str):
            raw = re.split(r"[\n|]+", raw)
        if isinstance(raw, (list, tuple)):
            lines = [" ".join(str(x).split())[:40] for x in raw]
            g["lines"] = [x for x in lines if x][:MAX_LINES] or list(DEFAULT_GREETER["lines"])
    if "way" in data:
        g["way"] = " ".join(str(data.get("way") or "").split())[:40] or DEFAULT_GREETER["way"]
    return g


def set_door(screen_id, data):
    """Apply a settings patch. Switching the link on for the first time creates its token."""
    door = door_for(screen_id)
    if not isinstance(data, dict):
        raise DoorError("Bad request.")
    if "on" in data:
        door["on"] = bool(data["on"])
        if door["on"] and not TOKEN_RE.match(door.get("token") or ""):
            door["token"] = secrets.token_urlsafe(18)
    for key in ("agenda", "clock", "caption"):
        if key in data:
            door[key] = bool(data[key])
    if "title" in data:
        door["title"] = " ".join(str(data.get("title") or "").split())[:80]
    if "greeter" in data:
        door["greeter"] = _clean_greeter(data["greeter"], door["greeter"])
    return _save(screen_id, door)


def rotate(screen_id):
    """A new link; the old one stops working at once."""
    door = door_for(screen_id)
    door["token"] = secrets.token_urlsafe(18)
    door["on"] = True
    return _save(screen_id, door)


def screen_for_token(token):
    """(screen, door) for a door link, or (None, None). Only a switched-on link resolves."""
    if not TOKEN_RE.match(token or ""):
        return None, None
    style = ScreenStyle.objects.filter(settings__door__token=token).first()
    if not style:
        return None, None
    door = door_for(style.screen_id)
    if not door.get("on") or door.get("token") != token:
        return None, None
    from hanns.models import BigScreen
    screen = BigScreen.objects.filter(pk=style.screen_id).first()
    return (screen, door) if screen else (None, None)


def host_view(screen, request=None):
    """What the host panel needs: settings plus the full link (never sent to the door page itself)."""
    door = door_for(screen.id)
    url = ""
    if door.get("on") and door.get("token"):
        path = f"/screenart/door/{door['token']}/"
        url = request.build_absolute_uri(path) if request else path
    return dict(door, url=url)


def public_state(screen, door, request=None):
    """Everything the door page draws — and nothing else."""
    from django.utils import timezone

    from . import program, services

    active = bool(screen.is_active)
    out = {
        "ok": True, "active": active,
        "name": door.get("title") or screen.name,
        "show": {"agenda": door["agenda"], "clock": door["clock"], "caption": door["caption"]},
        "greeter": door["greeter"],
        "server_now": timezone.now().isoformat(),
        "background": None, "caption": "", "countdown": "", "event": None,
    }
    bd = services.state_for(screen.id) if active else None
    if bd:
        out["background"] = {k: bd.get(k) for k in ("images", "active", "fit", "dim", "motion", "slideshow")}
        if door["caption"]:
            out["caption"] = bd.get("caption") or ""
            out["countdown"] = bd.get("countdown") or ""
    if active:
        ev = program.event_data(screen, request)
        if ev:
            out["event"] = {
                "title": ev.get("title") or "", "location": ev.get("location") or "",
                "tz": ev.get("tz") or "UTC", "now": ev.get("now"), "starts": ev.get("starts"), "ends": ev.get("ends"),
                "agenda": ev.get("agenda") if door["agenda"] else [],
            }
    return out
