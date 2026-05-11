import io
import qrcode
from django.contrib.auth.decorators import login_required
from django.http import HttpResponse, JsonResponse, Http404
from django.shortcuts import render, redirect, get_object_or_404
from django.urls import reverse
from django.views.decorators.http import require_GET

from core.templates_registry import get_template
from games.avatars import AVATARS, avatars_grouped, avatar_by_id
from .models import LiveSession, Participant


# ─────────────────────────── helpers ───────────────────────────

def _logo_url_for(session):
    """Return the live URL of the session's logo, or None.

    Uses session.quiz.logo for games and session.questionnaire.logo for polls.
    Wrapped in try/except because ImageField.url raises ValueError when the
    field has no file attached, AND raises (typically) if the underlying file
    has been deleted from disk while the DB still holds a name.
    """
    logo = None
    if session.kind == "game" and getattr(session, "quiz", None):
        logo = getattr(session.quiz, "logo", None)
    elif session.kind == "poll" and getattr(session, "questionnaire", None):
        logo = getattr(session.questionnaire, "logo", None)
    try:
        if logo and getattr(logo, "name", "") and getattr(logo, "url", ""):
            return logo.url
    except (ValueError, AttributeError):
        pass
    return None


def _chart_background_for(session):
    """Return the chart background id for the live chart wrapper (default 'normal').

    Only games carry a chart_background today; polls render against the stage
    template's background and don't need an extra scenery layer.
    """
    if session.kind == "game" and getattr(session, "quiz", None):
        return getattr(session.quiz, "chart_background", "normal") or "normal"
    return "normal"


@login_required
def present(request, code):
    session = get_object_or_404(
        LiveSession.objects.select_related("questionnaire", "quiz"),
        code=code,
        owner=request.user,
    )

    template = get_template(session.template_id)

    join_url = request.build_absolute_uri(
        reverse("presentations:join_code", args=[session.code])
    )

    return render(request, "presentations/present.html", {
        "session": session,
        "template": template,
        "logo_url": _logo_url_for(session),
        "chart_background": _chart_background_for(session),
        "join_url": join_url,
        "avatars": AVATARS,
        "avatar_groups": avatars_grouped(),
    })

def join_landing(request):
    """User typed `/live/join/` — show code-entry form."""
    return render(request, "presentations/join.html")


def join_code(request, code):
    """Participant joining via code or QR."""
    try:
        session = LiveSession.objects.select_related("questionnaire", "quiz").get(code=code)
    except LiveSession.DoesNotExist:
        return render(request, "presentations/join.html", {"error": "Session not found."})

    if session.state == "ended":
        return render(request, "presentations/join.html", {"error": "This session has ended."})

    common = {
        "session": session,
        "template": get_template(session.template_id),
        "logo_url": _logo_url_for(session),
        "chart_background": _chart_background_for(session),
        "avatars": AVATARS,
        "avatar_groups": avatars_grouped(),
    }

    if session.kind == "game":
        return render(request, "presentations/play_game.html", common)
    return render(request, "presentations/play_poll.html", common)


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