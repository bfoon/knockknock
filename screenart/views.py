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


@require_POST
def look(request, token):
    """How things come onto the big screen: {entrance} saves it; {preview: true}
    replays it on the projector now, on whatever is showing."""
    screen = _screen(token)
    if not screen.is_active:
        return _stopped()
    try:
        data = json.loads(request.body or b"{}")
    except (ValueError, TypeError):
        return JsonResponse({"ok": False, "error": "Bad JSON."}, status=400)
    from hanns import screen as svc
    if data.get("entrance") is not None:
        try:
            program.set_look(screen.id, data)
        except program.ProgramError as e:
            return JsonResponse({"ok": False, "error": str(e)}, status=400)
        svc.push_state(screen)
    if data.get("preview"):
        svc._send(svc.screen_group(screen.id), {"type": "screen.event", "payload": {
            "type": "look_preview", "entrance": program.look_for(screen.id)["entrance"]}})
    return JsonResponse({"ok": True, "look": program.look_for(screen.id)})


@require_POST
def teams(request, token):
    """A Teams meeting on the big screen: open (with the pasted invite / link /
    ID + passcode), close, check (parse only), closed (the projector's window
    was shut by hand). The screen's token is the credential, as for every
    other screen action (screenart/teams.py)."""
    from . import teams as tm
    screen = _screen(token)
    if not screen.is_active:
        return _stopped()
    try:
        data = json.loads(request.body or b"{}")
    except (ValueError, TypeError):
        return JsonResponse({"ok": False, "error": "Bad JSON."}, status=400)
    try:
        out = tm.act(screen.id, data)
    except tm.TeamsError as e:
        return JsonResponse({"ok": False, "error": str(e)}, status=400)
    if data.get("action") != "check":
        from hanns import screen as svc
        svc.push_state(screen)
    return JsonResponse({"ok": True, "teams": out})


SAMPLE_EXTS = {".mp3", ".wav", ".ogg", ".oga", ".m4a", ".aac", ".webm", ".flac", ".opus"}


@require_POST
def dj_sample(request, token):
    """Upload a sound for a Drums & FX pad. Stored for this screen only; the booth
    then puts it on a pad (media action pad_custom)."""
    import os
    import uuid
    from django.conf import settings
    from django.core.files.storage import default_storage
    screen = _screen(token)
    if not screen.is_active:
        return _stopped()
    f = request.FILES.get("sample") or request.FILES.get("file")
    if not f:
        return JsonResponse({"ok": False, "error": "No sound file was uploaded."}, status=400)
    ext = os.path.splitext(getattr(f, "name", "") or "")[1].lower()
    ctype = (getattr(f, "content_type", "") or "").lower()
    if ext not in SAMPLE_EXTS or not (ctype.startswith("audio/") or ctype in ("video/webm", "application/octet-stream", "")):
        return JsonResponse({"ok": False, "error": "Use an audio file: MP3, WAV, OGG, M4A or FLAC."}, status=400)
    limit = int(getattr(settings, "SCREENART_SAMPLE_MAX_SIZE", 8 * 1024 * 1024))
    if f.size > limit:
        return JsonResponse({"ok": False, "error": f"Keep pad sounds under {limit // (1024 * 1024)} MB."}, status=413)
    saved = default_storage.save(f"{program.SAMPLE_DIR}/{screen.id}/{uuid.uuid4().hex}{ext}", f)
    url = default_storage.url(saved)
    if not url.startswith(("http://", "https://", "//")):
        url = url if url.startswith("/") else "/" + url
    name = os.path.splitext(os.path.basename(getattr(f, "name", "") or "My sound"))[0][:40] or "My sound"
    return JsonResponse({"ok": True, "url": url, "name": name})


@require_POST
def dj_fx(request, token):
    """A scratch / FX pad from the DJ booth → straight to the projectors over the
    screen socket. Nothing is saved; the music state itself still moves through
    `media` (seek on scratch release, pause after a brake, …)."""
    screen = _screen(token)
    if not screen.is_active:
        return _stopped()
    data, bad = _json(request)
    if bad:
        return bad
    try:
        payload = program.dj_fx(data)
    except program.ProgramError as e:
        return JsonResponse({"ok": False, "error": str(e)}, status=400)
    from hanns import screen as svc
    svc._send(svc.screen_group(screen.id), {"type": "screen.event", "payload": payload})
    return JsonResponse({"ok": True})


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
