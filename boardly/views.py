"""
boardly/views.py — HTTP views for the Boardly board.

Roles:
  • board_play(code)      — participant sticky-pad   → play_board.html
  • board_stage(code)     — presenter projector view → stage_board.html
  • board_create()        — make a new board (owner)
  • board_list()          — all of the owner's saved boards
  • board_delete(code)    — delete a board (owner, POST only)

The WebSocket (consumers.BoardConsumer) handles everything live; these
views just render the shells and supply context.
"""

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.views.decorators.http import require_POST

from .models import BoardSession


def _join_url(request, session):
    """Absolute URL a phone hits when it scans the QR code."""
    return request.build_absolute_uri(f"/board/{session.code}/")


def board_play(request, code):
    """Participant view — the phone/tablet sticky pad."""
    session = get_object_or_404(BoardSession, code=code.upper())
    return render(request, "boardly/play_board.html", {
        "session": session,
        "logo_url": getattr(session.owner, "logo_url", None)
        if session.owner_id else None,
    })


def board_stage(request, code):
    """Presenter view — the live projector board with QR code."""
    session = get_object_or_404(BoardSession, code=code.upper())
    return render(request, "boardly/stage_board.html", {
        "session": session,
        "join_url": _join_url(request, session),
        "logo_url": getattr(session.owner, "logo_url", None)
        if session.owner_id else None,
    })


@login_required
def board_create(request):
    """Create a board and jump straight to the presenter screen."""
    if request.method == "POST":
        session = BoardSession.objects.create(
            owner=request.user,
            title=request.POST.get("title", "Idea Board")[:140] or "Idea Board",
            prompt=request.POST.get("prompt", "Share your idea")[:200],
            mode=request.POST.get("mode", "open"),
            layout=request.POST.get("layout", "grid"),
            state="open",
        )
        # Optional: seed topic columns from a comma-separated field.
        groups = request.POST.get("groups", "").strip()
        if groups:
            from .models import BoardGroup
            for i, name in enumerate(g.strip() for g in groups.split(",")):
                if name:
                    BoardGroup.objects.create(
                        session=session, name=name[:60], position=i,
                    )
        return redirect("boardly:stage", code=session.code)

    return render(request, "boardly/create_board.html")


@login_required
def board_list(request):
    """All boards owned by the current user — the 'saved boards' view."""
    boards = (
        BoardSession.objects
        .filter(owner=request.user)
        .order_by("-created_at")
    )
    return render(request, "boardly/board_list.html", {
        "boards": boards,
        "boards_total": boards.count(),
    })


@login_required
@require_POST
def board_delete(request, code):
    """Delete a board the current user owns, then return to `next`."""
    session = get_object_or_404(
        BoardSession, code=code.upper(), owner=request.user,
    )
    title = session.title
    session.delete()
    messages.success(request, f"Deleted “{title}”.")
    # Honour an explicit ?next / form field; otherwise the board list.
    nxt = request.POST.get("next") or request.GET.get("next")
    return redirect(nxt or reverse("boardly:list"))