"""Chalk Link — an HTTP API between a board's projects and everything else.

A board can open one Link. It is a secret key and, behind it, a table of
named values called tags. Three kinds of thing talk to it, and none of them
needs to know which of the others is on the far side:

* the Circuit Lab, while it is open and switched on, publishes what the
  simulated parts are doing (`d1.on`, `servo1.angle`) and obeys tags written
  for its inputs (`sw1.pressed`, `pir1.motion`);
* a real device — a Raspberry Pi, an ESP32 — reads and writes the same tags
  with two HTTP calls, so a physical project can stand in for the simulated
  one, mirror it, or be driven by it;
* your own software reads the tags as its inputs and writes them as its
  commands.

Everything under /chalk/api/link/<key>/ is public to whoever holds the key:
no cookie, no CSRF token, and CORS open, because the callers are
microcontrollers and other people's servers. The key is the only secret —
the owner can rotate it, which cuts every device off at once.

    GET  …/                  what this link is, and every tag
    GET  …/tags/             every tag            ?since=<seq>  only newer ones
                                                  ?flat=1       just {name: value}
    POST …/tags/             {"values": {"lamp": true}, "by": "my-app"}
    GET  …/tags/<name>/      one tag              ?raw=1        the bare value, as text
    PUT  …/tags/<name>/      {"value": 21.5}      (POST works too; DELETE forgets it)
    GET  …/set/?lamp=1       write from a URL — for devices that can only GET
    GET  …/events/           the last changes, oldest first   ?since=<seq>

The simulation itself runs in the browser, not here. This file is a
mailbox: it stores the latest value of each tag and a short history, and
hands them to whoever asks.
"""

import json
import math
import re

from django.contrib.auth.mixins import LoginRequiredMixin
from django.db import transaction
from django.http import HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404
from django.urls import reverse
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.csrf import csrf_exempt

from . import throttle
from .models import Board, BoardLink

TAG_RE = re.compile(r"^[a-z0-9][a-z0-9_.\-]{0,47}$")
BY_RE = re.compile(r"^[A-Za-z0-9_.\- ]{1,32}$")
MAX_TAGS = 200
MAX_LOG = 300
MAX_TEXT = 240
MAX_BODY = 20_000
RATE = 1800            # requests a minute, per key: three clients polling twice a second, and room to spare


class Bad(ValueError):
    pass


def _json(data, status=200):
    r = JsonResponse(data, status=status)
    return _open(r)


def _open(r):
    r["Access-Control-Allow-Origin"] = "*"
    r["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    r["Access-Control-Allow-Headers"] = "Content-Type, X-Chalk-By"
    r["Access-Control-Max-Age"] = "86400"
    r["Cache-Control"] = "no-store"
    return r


def _err(msg, status=400):
    return _json({"ok": False, "error": msg}, status)


def clean_name(name):
    name = str(name or "").strip().lower()
    if not TAG_RE.match(name):
        raise Bad(f"'{name[:60]}' is not a tag name: use a-z, 0-9, dot, dash and underscore, up to 48 characters")
    return name


def clean_value(v):
    """A tag holds one small plain value: a number, true/false, a short
    string, or null. Anything bigger belongs in the caller's own database."""
    if v is None or isinstance(v, bool):
        return v
    if isinstance(v, int):
        if abs(v) > 2**53:
            raise Bad("a number is too large")
        return v
    if isinstance(v, float):
        if not math.isfinite(v):
            raise Bad("a number is not finite")
        return round(v, 6)
    if isinstance(v, str):
        if len(v) > MAX_TEXT:
            raise Bad(f"a text value is longer than {MAX_TEXT} characters")
        return v
    raise Bad("a tag's value must be a number, true/false, text or null")


def guess(text):
    """A value that arrived as text in a URL: 1, 21.5, true, on, hello."""
    t = text.strip()
    low = t.lower()
    if low in ("true", "on", "yes", "high"):
        return True
    if low in ("false", "off", "no", "low"):
        return False
    if low in ("null", "none", ""):
        return None
    try:
        return int(t)
    except ValueError:
        pass
    try:
        f = float(t)
        if math.isfinite(f):
            return f
    except ValueError:
        pass
    return t


def clean_by(by):
    by = str(by or "").strip()
    return by if BY_RE.match(by) else "api"


def write(link_id, values, by):
    """Store new values. Only a value that actually changed gets a new
    sequence number, so a device re-sending "still 21.5" every second does
    not bury the changes that matter. Returns the link's sequence number."""
    values = {clean_name(k): clean_value(v) for k, v in values.items()}
    if not values:
        raise Bad("no values were sent")
    now = timezone.now().isoformat(timespec="milliseconds")
    with transaction.atomic():
        link = BoardLink.objects.select_for_update().get(pk=link_id)
        state, log = link.state or {}, link.log or []
        changed = False
        for name, v in values.items():
            cur = state.get(name)
            if cur is None and len(state) >= MAX_TAGS:
                raise Bad(f"this link already has {MAX_TAGS} tags")
            if cur is not None and cur.get("v") == v and type(cur.get("v")) is type(v):
                continue
            link.seq += 1
            state[name] = {"v": v, "s": link.seq, "t": now, "by": by}
            log.append([link.seq, now, name, v, by])
            changed = True
        if changed:
            link.state, link.log = state, log[-MAX_LOG:]
            link.save(update_fields=["state", "log", "seq", "updated_at"])
        return link.seq


def forget(link_id, name):
    with transaction.atomic():
        link = BoardLink.objects.select_for_update().get(pk=link_id)
        if name in (link.state or {}):
            del link.state[name]
            link.save(update_fields=["state", "updated_at"])
            return True
    return False


def _tag(name, e):
    return {"name": name, "value": e.get("v"), "seq": e.get("s"), "at": e.get("t"), "by": e.get("by")}


def _tags(link, since=0, flat=False):
    items = {k: e for k, e in (link.state or {}).items() if e.get("s", 0) > since}
    if flat:
        return {k: e.get("v") for k, e in items.items()}
    return {k: _tag(k, e) for k, e in items.items()}


def _since(request):
    try:
        return max(0, int(request.GET.get("since") or 0))
    except ValueError:
        return 0


def _body(request):
    if len(request.body) > MAX_BODY:
        raise Bad("the request is too large")
    if not request.body:
        return {}
    try:
        data = json.loads(request.body)
    except (ValueError, UnicodeDecodeError):
        raise Bad("the body is not JSON")
    return data


def api(view):
    """Find the link for the key in the URL, answer preflights, keep the
    rate sane, and turn Bad into a 400 with the reason in it."""
    @csrf_exempt
    def wrapped(request, key, *args, **kwargs):
        if request.method == "OPTIONS":
            return _open(HttpResponse(status=204))
        link = BoardLink.objects.filter(key=key).select_related("board").first()
        if link is None:
            return _err("no link has this key (it may have been rotated)", 404)
        if not throttle.hit("link", link.pk, RATE, 60):
            return _err("too many requests: slow down to a few a second", 429)
        try:
            return view(request, link, *args, **kwargs)
        except Bad as e:
            return _err(str(e))
    return wrapped


@api
def info(request, link):
    base = request.build_absolute_uri(reverse("chalk:link_api", args=[link.key]))
    return _json({
        "ok": True, "board": link.board.title, "seq": link.seq, "tags": _tags(link),
        "urls": {"tags": base + "tags/", "tag": base + "tags/<name>/", "set": base + "set/?<name>=<value>", "events": base + "events/"},
    })


@api
def tags(request, link):
    if request.method == "GET":
        flat = request.GET.get("flat") in ("1", "true")
        data = _tags(link, _since(request), flat)
        return _json(data if flat else {"ok": True, "seq": link.seq, "tags": data})
    if request.method in ("POST", "PUT"):
        data = _body(request)
        if not isinstance(data, dict):
            raise Bad("send an object: {\"values\": {\"name\": value}}")
        values = data.get("values") if isinstance(data.get("values"), dict) else {k: v for k, v in data.items() if k != "by"}
        by = clean_by(data.get("by") or request.headers.get("X-Chalk-By"))
        return _json({"ok": True, "seq": write(link.pk, values, by)})
    return _err("use GET or POST", 405)


@api
def tag(request, link, name):
    name = clean_name(name)
    if request.method == "GET":
        e = (link.state or {}).get(name)
        if request.GET.get("raw") in ("1", "true"):
            v = e.get("v") if e else None
            text = "" if v is None else ("1" if v is True else "0" if v is False else str(v))
            return _open(HttpResponse(text, content_type="text/plain; charset=utf-8", status=200 if e else 404))
        if e is None:
            return _err(f"there is no tag called '{name}' yet", 404)
        return _json(dict(_tag(name, e), ok=True))
    if request.method in ("POST", "PUT"):
        ctype = request.content_type or ""
        if "json" in ctype or request.body[:1] in (b"{", b"["):
            data = _body(request)
            value = data.get("value") if isinstance(data, dict) else data
            by = clean_by((data.get("by") if isinstance(data, dict) else None) or request.headers.get("X-Chalk-By"))
        else:                                   # a bare value: curl -d 21.5
            value = guess(request.body.decode("utf-8", "replace")[: MAX_TEXT + 1])
            by = clean_by(request.headers.get("X-Chalk-By"))
        return _json({"ok": True, "seq": write(link.pk, {name: value}, by)})
    if request.method == "DELETE":
        return _json({"ok": True, "removed": forget(link.pk, name)})
    return _err("use GET, PUT or DELETE", 405)


@api
def set_from_url(request, link):
    """…/set/?lamp=1&fan=off — for the smallest devices, which can open a
    URL but not much else."""
    values = {k: guess(v) for k, v in request.GET.items() if k != "by"}
    return _json({"ok": True, "seq": write(link.pk, values, clean_by(request.GET.get("by")))})


@api
def events(request, link):
    since = _since(request)
    rows = [{"seq": r[0], "at": r[1], "name": r[2], "value": r[3], "by": r[4]} for r in (link.log or []) if r[0] > since]
    return _json({"ok": True, "seq": link.seq, "events": rows})


# --------------------------------------------------------------------------
# the owner's side: open, rotate or close a board's link
# --------------------------------------------------------------------------

class LinkManageView(LoginRequiredMixin, View):
    raise_exception = True

    def _state(self, request, board):
        link = BoardLink.objects.filter(board=board).first()
        if link is None:
            return {"ok": True, "open": False}
        return {"ok": True, "open": True, "key": link.key, "seq": link.seq,
                "url": request.build_absolute_uri(reverse("chalk:link_api", args=[link.key]))}

    def get(self, request, pk):
        board = get_object_or_404(Board, pk=pk, owner=request.user)
        return JsonResponse(self._state(request, board))

    def post(self, request, pk):
        board = get_object_or_404(Board, pk=pk, owner=request.user)
        try:
            action = json.loads(request.body or b"{}").get("action")
        except (ValueError, AttributeError):
            action = None
        action = action or request.POST.get("action")
        link = BoardLink.objects.filter(board=board).first()
        if action == "open":
            if link is None:
                BoardLink.objects.create(board=board)
        elif action == "rotate" and link is not None:
            link.rotate()
        elif action == "clear" and link is not None:
            link.state, link.log = {}, []
            link.save(update_fields=["state", "log", "updated_at"])
        elif action == "close" and link is not None:
            link.delete()
        else:
            return JsonResponse({"ok": False, "error": "unknown action"}, status=400)
        return JsonResponse(self._state(request, board))
