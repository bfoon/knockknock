"""
hanns/screen_views.py — Hanns Big Screen.

A host opens ONE tokenised link on the projector and goes full screen.
Presenters share their decks to it with a six-digit share code; the host
pulls the queue down from a small arrow at the top of the screen, picks
the next deck, and it plays inside the same full-screen page — the host
never has to leave full screen to change presenter.

Host (signed in):
  • screen_home            GET   /hanns/screen/                 my screens
  • screen_create          POST  /hanns/screen/new/             open a new one

The screen itself (the token in the URL is the credential):
  • screen_stage           GET   /hanns/screen/s/<token>/       full-screen shell
  • screen_state           GET   …/state/                       JSON snapshot
  • screen_select          POST  …/select/                      put a deck on air
  • screen_lobby           POST  …/lobby/                       back to the lobby
  • screen_share_remove    POST  …/share/<id>/remove/
  • screen_control_code    POST  …/share/<id>/control-code/     issue / reissue
  • screen_settings        POST  …/settings/                    rename, show code
  • screen_rotate_code     POST  …/rotate-code/                 new share code
  • screen_stop            POST  …/stop/                        end everything
  • screen_frame           GET   …/deck/<id>/                   the embedded stage

Presenter (signed in, can edit the deck):
  • deck_screen_share      POST  /hanns/<code>/screen-share/    enter share code
  • screen_share_status    GET   /hanns/screen/share/<id>/
  • screen_share_withdraw  POST  /hanns/screen/share/<id>/withdraw/

Presenter without a laptop:
  • screen_control_entry   GET/POST /hanns/screen/control/      host-issued code
"""

import json

from django.contrib.auth.decorators import login_required
from django.http import Http404, JsonResponse, HttpResponseBadRequest
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.clickjacking import xframe_options_sameorigin
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_POST

from . import screen as svc


# ── helpers ──────────────────────────────────────────────────────────
def _screen_or_404(token):
    from .models import BigScreen
    return get_object_or_404(BigScreen, token=token)


def _active_screen_or_json(token):
    """For actions: a stopped screen answers 410 so the page can stand down."""
    screen = _screen_or_404(token)
    if not screen.is_active:
        return screen, JsonResponse(
            {"ok": False, "stopped": True, "error": "This big screen has been stopped."},
            status=410,
        )
    return screen, None


def _open_share_on(screen, share_id):
    from .models import ScreenShare
    return ScreenShare.objects.select_related("deck", "screen").filter(
        pk=share_id, screen=screen, status__in=ScreenShare.OPEN_STATES,
    ).first()


def _post_value(request, key, default=""):
    """Accept form-encoded or JSON bodies."""
    if request.content_type == "application/json":
        try:
            data = json.loads(request.body or "{}")
        except (ValueError, TypeError):
            data = {}
        return data.get(key, default)
    return request.POST.get(key, default)


def _abs(request, name, *args):
    return request.build_absolute_uri(reverse(name, args=args))


# ── host dashboard ───────────────────────────────────────────────────
@login_required
def screen_home(request):
    from .models import BigScreen
    active = list(BigScreen.objects.filter(owner=request.user, is_active=True))
    ended = list(BigScreen.objects.filter(owner=request.user, is_active=False)[:6])
    cards = []
    for s in active:
        cards.append({
            "screen": s,
            "url": _abs(request, "hanns:screen_stage", s.token),
            "state_json": json.dumps(svc.screen_state(s)),
            "ws_path": f"/ws/hanns/screen/{s.token}/",
        })
    return render(request, "hanns/screen_home.html", {
        "cards": cards,
        "ended": ended,
        "control_entry_url": _abs(request, "hanns:screen_control_entry"),
        "fresh": request.GET.get("new", ""),
    })


@login_required
@require_POST
def screen_create(request):
    from .models import BigScreen
    name = (request.POST.get("name") or "").strip()[:80] or "Big screen"
    screen = BigScreen.objects.create(owner=request.user, name=name)
    return redirect(reverse("hanns:screen_home") + f"?new={screen.id}")


# ── the screen ───────────────────────────────────────────────────────
def screen_stage(request, token):
    screen = _screen_or_404(token)
    if screen.is_active:
        screen.last_seen_at = timezone.now()
        screen.save(update_fields=["last_seen_at"])
    base = f"/hanns/screen/s/{screen.token}/"
    return render(request, "hanns/screen_stage.html", {
        "screen": screen,
        "state_json": json.dumps(svc.screen_state(screen)),
        "cfg_json": json.dumps({
            "wsPath": f"/ws/hanns/screen/{screen.token}/",
            "stateUrl": base + "state/",
            "selectUrl": base + "select/",
            "lobbyUrl": base + "lobby/",
            "settingsUrl": base + "settings/",
            "rotateUrl": base + "rotate-code/",
            "stopUrl": base + "stop/",
            "shareBase": base + "share/",
            "controlEntryUrl": _abs(request, "hanns:screen_control_entry"),
            "hannsUrl": _abs(request, "hanns:list"),
            "backdropBase": f"/screenart/s/{screen.token}/",
        }),
    })


# ── the paired slide remote (hanns/remote.py) ────────────────────────
def _remote_cookie(request):
    from . import remote
    return remote.parse_cookie(request.COOKIES.get(remote.COOKIE))


def _remote_screen(screen_id):
    from .models import BigScreen
    try:
        return BigScreen.objects.select_related("current_share__deck").get(pk=screen_id)
    except Exception:
        return None


def _remote_status(request):
    """(payload, screen) for the phone holding this browser's remote cookie."""
    from . import remote
    sid, secret = _remote_cookie(request)
    screen = _remote_screen(sid) if sid else None
    if not screen or not screen.is_active:
        return {"state": "unpaired"}, None
    st = dict(remote.status(screen.id, secret), screen=screen.name)
    if st["state"] == "paired":
        code, title = remote.deck_on(screen)
        st.update(deck=code, deck_title=title or "")
    return st, screen


@ensure_csrf_cookie
def remote_home(request):
    """The phone's way in. Paired + a deck on the screen → the full slide
    controller for that deck. Otherwise the pair / waiting page."""
    from . import remote
    from .models import Deck
    st, screen = _remote_status(request)
    if st["state"] == "paired" and st.get("deck"):
        deck = get_object_or_404(Deck, code=st["deck"])
        _, secret = _remote_cookie(request)
        return render(request, "hanns/control.html", {
            "deck": deck,
            "deck_json": json.dumps(deck.as_dict()),
            "control_pin": "remote:" + secret,           # the socket checks it against the screen
            "control_unlocked": True,
            "remote_screen": screen.name,
            "remote_status_url": reverse("hanns:remote_status"),
            "remote_home_url": reverse("hanns:remote_home"),
        })
    return render(request, "hanns/screen_remote.html", {
        "status_json": json.dumps(st),
        "code": (request.GET.get("code") or "").strip()[:8],
    })


def remote_qr(request):
    """An SVG QR for the pairing link with the screen code filled in."""
    import io
    import segno
    from django.http import HttpResponse
    code = "".join(ch for ch in str(request.GET.get("code") or "") if ch.isdigit())[:6]
    url = request.build_absolute_uri(reverse("hanns:remote_home")) + (f"?code={code}" if code else "")
    buf = io.BytesIO()
    segno.make(url, error="m").save(buf, kind="svg", scale=6, border=2, dark="#0b0a12", light="#ffffff")
    resp = HttpResponse(buf.getvalue(), content_type="image/svg+xml")
    resp["Cache-Control"] = "private, max-age=300"
    return resp


@require_POST
def remote_pair(request):
    from . import remote
    from .models import BigScreen
    left, locked = svc.throttle_check(request, "remote")
    if locked:
        return JsonResponse({"ok": False, "error": "Too many wrong codes. Wait ten minutes and try again."}, status=429)
    try:
        data = json.loads(request.body or b"{}")
    except (ValueError, TypeError):
        return HttpResponseBadRequest("Bad JSON")
    code = "".join(ch for ch in str(data.get("code") or "") if ch.isdigit())
    screen = BigScreen.objects.filter(share_code=code, is_active=True).first() if code else None
    if not screen:
        svc.throttle_miss(request, "remote")
        return JsonResponse({"ok": False, "error": "No big screen with that code. It's on the lobby screen."}, status=404)
    sid, old = _remote_cookie(request)
    try:
        secret, req = remote.request_pair(screen.id, data.get("name"), old if sid == str(screen.id) else None)
    except remote.RemoteError as e:
        return JsonResponse({"ok": False, "error": str(e)}, status=409)
    svc.push_state(screen)                                # the lobby + control board show the request
    resp = JsonResponse({"ok": True, "state": "pending", "match": req["match"], "screen": screen.name})
    resp.set_cookie(remote.COOKIE, f"{screen.id}.{secret}", max_age=60 * 60 * 24 * 30, httponly=True,
                    samesite="Lax", secure=request.is_secure())
    return resp


def remote_status(request):
    st, _ = _remote_status(request)
    return JsonResponse(dict(st, ok=True))


@require_POST
def remote_forget(request):
    from . import remote
    sid, secret = _remote_cookie(request)
    screen = _remote_screen(sid) if sid else None
    if screen and screen.is_active:
        if remote.forget(screen.id, secret):
            svc.push_lock_changed(screen)
        svc.push_state(screen)
    resp = JsonResponse({"ok": True, "state": "unpaired"})
    resp.delete_cookie(remote.COOKIE)
    return resp


@require_POST
def screen_remote(request, token):
    """Host: approve / deny a phone, unpair it, lock on/off. The screen's
    token is the credential, like every other screen action."""
    from . import remote
    screen, bad = _active_screen_or_json(token)
    if bad:
        return bad
    try:
        data = json.loads(request.body or b"{}")
    except (ValueError, TypeError):
        return HttpResponseBadRequest("Bad JSON")
    try:
        changed = remote.host_action(screen.id, data)
    except remote.RemoteError as e:
        return JsonResponse({"ok": False, "error": str(e)}, status=400)
    if changed:
        svc.push_lock_changed(screen)
    svc.push_state(screen)
    return JsonResponse({"ok": True, "state": svc.screen_state(screen)})


@login_required
def screen_dj(request, token):
    """The DJ booth on its own page — full screen on a laptop or tablet at the
    DJ table, kept awake while it's open. Only the screen's owner gets it
    (the booth can run everything the screen plays)."""
    screen = _screen_or_404(token)
    if screen.owner_id != request.user.id:
        raise Http404
    if not screen.is_active:
        return redirect(reverse("hanns:screen_home"))
    return render(request, "hanns/screen_dj.html", {
        "screen": screen,
        "state_json": json.dumps(svc.screen_state(screen)),
        "ws_path": f"/ws/hanns/screen/{screen.token}/",
        "back_url": reverse("hanns:screen_home"),
        "stage_url": _abs(request, "hanns:screen_stage", screen.token),
    })


def screen_state(request, token):
    screen = _screen_or_404(token)
    if screen.is_active:
        screen.last_seen_at = timezone.now()
        screen.save(update_fields=["last_seen_at"])
    return JsonResponse({"ok": True, "state": svc.screen_state(screen)})


@require_POST
def screen_select(request, token):
    from .models import ScreenShare
    screen, stopped = _active_screen_or_json(token)
    if stopped:
        return stopped
    share = _open_share_on(screen, _post_value(request, "share"))
    if not share:
        return JsonResponse({"ok": False, "error": "That deck is no longer shared."}, status=404)

    if screen.current_share_id and screen.current_share_id != share.id:
        ScreenShare.objects.filter(
            pk=screen.current_share_id, status=ScreenShare.STATUS_LIVE,
        ).update(status=ScreenShare.STATUS_SHOWN)
    share.status = ScreenShare.STATUS_LIVE
    share.went_live_at = timezone.now()
    share.save(update_fields=["status", "went_live_at"])
    screen.current_share = share
    screen.save(update_fields=["current_share"])

    svc.push_state(screen, notice={
        "kind": "live", "share": str(share.id),
        "title": share.deck.title, "sharer": share.sharer_name,
    })
    svc.push_lock_changed(screen)                         # a paired remote's lock now covers this deck
    return JsonResponse({"ok": True, "frame_url": reverse(
        "hanns:screen_frame", args=[screen.token, share.id])})


@require_POST
def screen_lobby(request, token):
    from .models import ScreenShare
    screen, stopped = _active_screen_or_json(token)
    if stopped:
        return stopped
    if screen.current_share_id:
        ScreenShare.objects.filter(
            pk=screen.current_share_id, status=ScreenShare.STATUS_LIVE,
        ).update(status=ScreenShare.STATUS_SHOWN)
        screen.current_share = None
        screen.save(update_fields=["current_share"])
    svc.push_state(screen)
    return JsonResponse({"ok": True})


@require_POST
def screen_share_remove(request, token, share_id):
    from .models import ScreenShare
    screen, stopped = _active_screen_or_json(token)
    if stopped:
        return stopped
    share = _open_share_on(screen, share_id)
    if not share:
        return JsonResponse({"ok": True})          # already gone — idempotent
    had_code = bool(share.control_code)
    share.status = ScreenShare.STATUS_REMOVED
    share.closed_at = timezone.now()
    share.control_code = ""
    share.control_code_at = None
    share.save(update_fields=["status", "closed_at", "control_code", "control_code_at"])
    if screen.current_share_id == share.id:
        screen.current_share = None
        screen.save(update_fields=["current_share"])
    if had_code:
        svc.revoke_share_controllers([share])
    svc.push_state(screen)
    return JsonResponse({"ok": True})


@require_POST
def screen_control_code(request, token, share_id):
    """Issue a control code for one shared deck (or reissue: the old one
    stops working and any phone holding it drops back to the code page)."""
    screen, stopped = _active_screen_or_json(token)
    if stopped:
        return stopped
    share = _open_share_on(screen, share_id)
    if not share:
        return JsonResponse({"ok": False, "error": "That deck is no longer shared."}, status=404)
    reissue = str(_post_value(request, "reissue", "")).lower() in ("1", "true", "yes")
    if share.control_code and not reissue:
        code = share.control_code
    else:
        if share.control_code:
            svc.revoke_share_controllers([share])
        code = share.issue_control_code()
    svc.push_state(screen)
    return JsonResponse({
        "ok": True, "code": code,
        "entry_url": _abs(request, "hanns:screen_control_entry"),
        "title": share.deck.title, "sharer": share.sharer_name,
    })


@require_POST
def screen_settings(request, token):
    screen, stopped = _active_screen_or_json(token)
    if stopped:
        return stopped
    fields = []
    name = _post_value(request, "name", None)
    if name is not None:
        screen.name = (str(name).strip()[:80]) or screen.name
        fields.append("name")
    show = _post_value(request, "show_code", None)
    if show is not None:
        screen.show_code_on_screen = str(show).lower() in ("1", "true", "yes", "on")
        fields.append("show_code_on_screen")
    if fields:
        screen.save(update_fields=fields)
    svc.push_state(screen)
    return JsonResponse({"ok": True, "state": svc.screen_state(screen)})


@require_POST
def screen_rotate_code(request, token):
    screen, stopped = _active_screen_or_json(token)
    if stopped:
        return stopped
    code = screen.rotate_share_code()
    svc.push_state(screen)
    return JsonResponse({"ok": True, "share_code": code})


@require_POST
def screen_stop(request, token):
    screen = _screen_or_404(token)
    if screen.is_active:
        # stop() returns the shares it closed (fetched before the bulk
        # update), so their decks are still known for the revoke.
        closed = screen.stop()
        svc.revoke_share_controllers(
            [s for s in closed if s.control_code]
        )
        svc.push_stopped(screen)
        try:                                   # a stopped screen can't come back: free its event backgrounds
            from screenart.services import delete_all
            delete_all(screen.id)
        except Exception:
            pass
    nxt = request.POST.get("next")
    if nxt and nxt.startswith("/") and not nxt.startswith("//"):
        return redirect(nxt)
    return JsonResponse({"ok": True, "stopped": True})


@xframe_options_sameorigin
def screen_frame(request, token, share_id):
    """The deck's own presentation stage, embedded in the big screen.

    Same template and player as /present/, in embed mode: no PIN, no
    controller QR, no exit or full-screen buttons (the big screen owns
    those), and ending the show hands control back to the big screen
    instead of navigating away.
    """
    from .models import DeckReaction, ScreenShare
    screen = _screen_or_404(token)
    share = get_object_or_404(
        ScreenShare.objects.select_related("deck"),
        pk=share_id, screen=screen,
    )
    if not screen.is_active or share.status != ScreenShare.STATUS_LIVE:
        return render(request, "hanns/screen_frame_off.html", {"screen": screen}, status=410)

    deck = share.deck
    if deck.state != "live":
        DeckReaction.objects.filter(deck=deck).delete()
        deck.state = "live"
        deck.save(update_fields=["state"])

    download_url = ""
    if deck.allow_download:
        download_url = request.build_absolute_uri(reverse(
            "hanns:audience_download",
            kwargs={"code": deck.code, "token": str(deck.download_token)},
        ))
    return render(request, "hanns/present.html", {
        "deck": deck,
        "deck_json": json.dumps(deck.as_dict()),
        "join_url": request.build_absolute_uri(reverse("hanns:join", args=[deck.code])),
        "control_url": "",
        "control_pin": "",
        "download_url": download_url,
        "embed": True,
        "screen_token": screen.token,
        "share_id": str(share.id),
    })


# ── presenter: share a deck to a screen ──────────────────────────────
@login_required
@require_POST
def deck_screen_share(request, code):
    from .models import BigScreen, Deck, ScreenShare
    from .views import _can_edit_deck

    deck = get_object_or_404(Deck, code=code.upper())
    if not _can_edit_deck(request.user, deck):
        return JsonResponse({"ok": False, "error": "You can only share decks you can edit."}, status=403)

    left, locked = svc.throttle_check(request, "share")
    if locked:
        return JsonResponse({
            "ok": False, "locked": True,
            "error": "Too many wrong codes. Wait ten minutes and try again.",
        }, status=429)

    raw = "".join(ch for ch in str(_post_value(request, "screen_code")) if ch.isdigit())
    screen = BigScreen.objects.filter(is_active=True, share_code=raw).first() if len(raw) == 6 else None
    if not screen:
        left = svc.throttle_miss(request, "share")
        return JsonResponse({
            "ok": False, "tries_left": left, "locked": left == 0,
            "error": "No big screen is using that code. Check it with the host."
            if left else "Too many wrong codes. Wait ten minutes and try again.",
        }, status=404)
    svc.throttle_clear(request, "share")

    note = str(_post_value(request, "note", ""))[:140].strip()
    name = svc.person_label(request.user)
    share = ScreenShare.objects.filter(
        screen=screen, deck=deck, status__in=ScreenShare.OPEN_STATES,
    ).first()
    is_new = share is None
    if is_new:
        share = ScreenShare.objects.create(
            screen=screen, deck=deck, shared_by=request.user,
            sharer_name=name, note=note,
        )
    else:
        share.shared_by = request.user
        share.sharer_name = name
        if note:
            share.note = note
        share.save(update_fields=["shared_by", "sharer_name", "note"])

    svc.push_state(screen, notice={
        "kind": "new" if is_new else "again",
        "share": str(share.id), "title": deck.title,
        "sharer": name, "slides": deck.slides.count(),
    })
    return JsonResponse({"ok": True, "share": _share_status_payload(request, share)})


def _share_status_payload(request, share):
    deck = share.deck
    is_owner = deck.owner_id == request.user.id
    return {
        "id": str(share.id),
        "status": share.status,
        "status_label": share.get_status_display(),
        "screen_name": share.screen.name,
        "screen_active": share.screen.is_active,
        "on_screen": share.status == share.STATUS_LIVE,
        "is_open": share.is_open,
        "deck_title": deck.title,
        "is_owner": is_owner,
        "present_url": reverse("hanns:present", args=[deck.code]) + "?controller=1" if is_owner else "",
        "control_entry_url": _abs(request, "hanns:screen_control_entry"),
        "status_url": reverse("hanns:screen_share_status", args=[share.id]),
        "withdraw_url": reverse("hanns:screen_share_withdraw", args=[share.id]),
    }


@login_required
def screen_share_status(request, share_id):
    from .models import ScreenShare
    share = get_object_or_404(
        ScreenShare.objects.select_related("deck", "screen"),
        pk=share_id, shared_by=request.user,
    )
    return JsonResponse({"ok": True, "share": _share_status_payload(request, share)})


@login_required
@require_POST
def screen_share_withdraw(request, share_id):
    from .models import ScreenShare
    share = get_object_or_404(
        ScreenShare.objects.select_related("deck", "screen"),
        pk=share_id, shared_by=request.user,
    )
    if share.is_open:
        had_code = bool(share.control_code)
        share.status = ScreenShare.STATUS_WITHDRAWN
        share.closed_at = timezone.now()
        share.control_code = ""
        share.control_code_at = None
        share.save(update_fields=["status", "closed_at", "control_code", "control_code_at"])
        screen = share.screen
        if screen.current_share_id == share.id:
            screen.current_share = None
            screen.save(update_fields=["current_share"])
        if had_code:
            svc.revoke_share_controllers([share])
        svc.push_state(screen, notice={
            "kind": "withdrawn", "share": str(share.id),
            "title": share.deck.title, "sharer": share.sharer_name,
        })
    return JsonResponse({"ok": True, "share": _share_status_payload(request, share)})


# ── presenter without a laptop: host-issued control code ─────────────
@ensure_csrf_cookie
def screen_control_entry(request):
    from .models import ScreenShare

    if request.method != "POST":
        left, locked = svc.throttle_check(request, "control")
        return render(request, "hanns/screen_control_entry.html", {
            "locked_out": locked,
            "ended": request.GET.get("ended") == "1",
        })

    left, locked = svc.throttle_check(request, "control")
    if locked:
        return JsonResponse({
            "ok": False, "locked": True,
            "error": "Too many attempts. Wait ten minutes and try again.",
        }, status=429)

    code = "".join(ch for ch in str(_post_value(request, "code")) if ch.isdigit())
    share = None
    if len(code) == 6:
        share = ScreenShare.objects.select_related("deck", "screen").filter(
            control_code=code, status__in=ScreenShare.OPEN_STATES,
            screen__is_active=True,
        ).first()
    if not share:
        left = svc.throttle_miss(request, "control")
        return JsonResponse({
            "ok": False, "tries_left": left, "locked": left == 0,
            "error": "That code is not right, or it has ended."
            if left else "Too many attempts. Wait ten minutes and try again.",
        }, status=403)

    svc.throttle_clear(request, "control")
    svc.grant_share_control(request, share)
    return JsonResponse({
        "ok": True,
        "redirect": reverse("hanns:control", args=[share.deck.code]),
        "title": share.deck.title,
    })
