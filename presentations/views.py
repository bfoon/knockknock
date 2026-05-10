import io
import qrcode
from django.contrib.auth.decorators import login_required
from django.http import HttpResponse, JsonResponse, Http404
from django.shortcuts import render, redirect, get_object_or_404
from django.urls import reverse
from django.views.decorators.http import require_GET

from core.templates_registry import get_template
from games.avatars import AVATARS, avatar_by_id
from .models import LiveSession, Participant


@login_required
def present(request, code):
    """Presenter view — owner only."""
    session = get_object_or_404(LiveSession, code=code, owner=request.user)
    join_url = request.build_absolute_uri(reverse("presentations:join_code", args=[code]))
    return render(request, "presentations/present.html", {
        "session": session,
        "template": get_template(session.template_id),
        "join_url": join_url,
    })


def join_landing(request):
    """User typed `/live/join/` — show code-entry form."""
    return render(request, "presentations/join.html")


def join_code(request, code):
    """Participant joining via code or QR."""
    try:
        session = LiveSession.objects.get(code=code)
    except LiveSession.DoesNotExist:
        return render(request, "presentations/join.html", {"error": "Session not found."})

    if session.state == "ended":
        return render(request, "presentations/join.html", {"error": "This session has ended."})

    if session.kind == "game":
        return render(request, "presentations/play_game.html", {
            "session": session,
            "template": get_template(session.template_id),
            "avatars": AVATARS,
        })
    return render(request, "presentations/play_poll.html", {
        "session": session,
        "template": get_template(session.template_id),
    })


@require_GET
def qr_png(request, code):
    """Serve a PNG QR code linking to the join URL."""
    if not LiveSession.objects.filter(code=code).exists():
        raise Http404
    url = request.build_absolute_uri(reverse("presentations:join_code", args=[code]))
    img = qrcode.make(url, box_size=10, border=2)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return HttpResponse(buf.getvalue(), content_type="image/png")
