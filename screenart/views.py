"""Big Screen event-background actions.

Like every other Big Screen action, the screen's token is the credential
(whoever can open the screen's own URL can run it). POST only, CSRF
protected, and a stopped screen answers 410.

    POST /screenart/s/<token>/upload/          multipart "file" (one or more)
    POST /screenart/s/<token>/settings/        JSON settings patch
    POST /screenart/s/<token>/<id>/delete/
"""

import json

from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.http import require_POST

from . import services


def _screen(token):
    from hanns.models import BigScreen
    return get_object_or_404(BigScreen, token=token)


def _push(screen):
    from hanns import screen as svc
    svc.push_state(screen)
    return svc.screen_state(screen)


def _stopped():
    return JsonResponse({"ok": False, "stopped": True, "error": "This big screen has been stopped."}, status=410)


@require_POST
def upload(request, token):
    screen = _screen(token)
    if not screen.is_active:
        return _stopped()
    files = request.FILES.getlist("file")
    if not files:
        return JsonResponse({"ok": False, "error": "Choose an image to upload."}, status=400)
    added, errors = [], []
    for f in files[:12]:
        try:
            added.append(str(services.add_image(screen.id, f).id))
        except services.BackdropError as e:
            errors.append(f"{f.name}: {e}")
    if not added:
        return JsonResponse({"ok": False, "error": errors[0] if errors else "Upload failed."}, status=400)
    return JsonResponse({"ok": True, "added": added, "errors": errors, "state": _push(screen)})


@require_POST
def settings(request, token):
    screen = _screen(token)
    if not screen.is_active:
        return _stopped()
    try:
        data = json.loads(request.body or "{}")
    except ValueError:
        return JsonResponse({"ok": False, "error": "That request was malformed."}, status=400)
    try:
        services.update_settings(screen.id, data)
    except services.BackdropError as e:
        return JsonResponse({"ok": False, "error": str(e)}, status=400)
    return JsonResponse({"ok": True, "state": _push(screen)})


@require_POST
def delete(request, token, image_id):
    screen = _screen(token)
    if not screen.is_active:
        return _stopped()
    if not services.delete_image(screen.id, image_id):
        return JsonResponse({"ok": False, "error": "That background is already gone."}, status=404)
    return JsonResponse({"ok": True, "state": _push(screen)})


# ───────────────────────── live polls & games ─────────────────────────
from django.contrib.auth.decorators import login_required
from django.shortcuts import render
from django.views.decorators.clickjacking import xframe_options_sameorigin
from django.views.decorators.http import require_GET

from . import live


def _json(request):
    try:
        return json.loads(request.body or "{}"), None
    except ValueError:
        return None, JsonResponse({"ok": False, "error": "That request was malformed."}, status=400)


@login_required
@require_POST
def live_share(request):
    """Presenter → big screen: {session: '123456', screen_code: '481770'}"""
    data, bad = _json(request)
    if bad:
        return bad
    try:
        share, screen = live.share(request.user, data.get("session"), data.get("screen_code"))
    except live.LiveError as e:
        return JsonResponse({"ok": False, "error": str(e)}, status=400)
    _push(screen)
    return JsonResponse({"ok": True, "screen": screen.name, "share": str(share.id)})


@login_required
@require_POST
def live_unshare(request):
    from hanns.models import BigScreen
    data, bad = _json(request)
    if bad:
        return bad
    for sid in live.unshare(request.user, data.get("session")):
        s = BigScreen.objects.filter(pk=sid).first()
        if s:
            _push(s)
    return JsonResponse({"ok": True})


@require_POST
def live_air(request, token, share_id):
    screen = _screen(token)
    if not screen.is_active:
        return _stopped()
    data, bad = _json(request)
    if bad:
        return bad
    try:
        live.set_on_air(screen.id, share_id, bool(data.get("on")))
    except live.LiveError as e:
        return JsonResponse({"ok": False, "error": str(e)}, status=404)
    return JsonResponse({"ok": True, "state": _push(screen)})


@require_POST
def live_control(request, token, share_id):
    screen = _screen(token)
    if not screen.is_active:
        return _stopped()
    data, bad = _json(request)
    if bad:
        return bad
    try:
        live.control(screen.id, share_id, str(data.get("action") or ""))
    except live.LiveError as e:
        return JsonResponse({"ok": False, "error": str(e)}, status=400)
    return JsonResponse({"ok": True, "state": _push(screen)})


@require_POST
def live_remove(request, token, share_id):
    screen = _screen(token)
    if not screen.is_active:
        return _stopped()
    live.remove(screen.id, share_id)
    return JsonResponse({"ok": True, "state": _push(screen)})


@require_GET
@xframe_options_sameorigin
def live_view(request, token, share_id):
    """What the projector shows: the live session, display only (no host
    controls). It joins the session as a read-only viewer."""
    from django.http import Http404
    from presentations import views as pv

    screen = _screen(token)
    share = live.ScreenLiveShare.objects.filter(screen_id=screen.id, pk=share_id).first()
    session = live._session(share.session_pk) if share and screen.is_active else None
    if not session:
        raise Http404("Not shared with this screen")
    join_url = request.build_absolute_uri(pv.reverse("presentations:join_code", args=[session.code]))
    return render(request, "presentations/present.html", {
        "session": session, "template": pv.get_template(session.template_id),
        "logo_url": pv._logo_url_for(session), "chart_background": pv._chart_background_for(session),
        "join_url": join_url, "avatars": pv.AVATARS, "avatar_groups": pv.avatars_grouped(),
        "themes": pv.public_themes(), "screen_mode": True,
    })


# ───────────────────────── music & video, event ─────────────────────────
from . import program


@require_POST
def media(request, token):
    screen = _screen(token)
    if not screen.is_active:
        return _stopped()
    data, bad = _json(request)
    if bad:
        return bad
    try:
        program.media_action(screen.id, data)
    except program.ProgramError as e:
        return JsonResponse({"ok": False, "error": str(e)}, status=400)
    return JsonResponse({"ok": True, "state": _push(screen)})


@require_GET
def events(request, token):
    screen = _screen(token)
    if not screen.is_active:
        return _stopped()
    return JsonResponse({"ok": True, "events": program.owner_events(screen)})


@require_POST
def event(request, token):
    screen = _screen(token)
    if not screen.is_active:
        return _stopped()
    data, bad = _json(request)
    if bad:
        return bad
    try:
        program.set_event(screen, data)
    except program.ProgramError as e:
        return JsonResponse({"ok": False, "error": str(e)}, status=400)
    return JsonResponse({"ok": True, "state": _push(screen)})


@require_GET
def event_data(request, token):
    screen = _screen(token)
    if not screen.is_active:
        return _stopped()
    return JsonResponse({"ok": True, "event": program.event_data(screen, request)})
