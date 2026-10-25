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
