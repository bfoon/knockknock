from django.contrib.auth.mixins import LoginRequiredMixin
from django.http import Http404, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.views import View

from .models import SURFACES, Board, BoardSession


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

def qr_data_uri(text, box_size=8, border=2):
    """PNG data URI for `text`. Lazy import so a missing qrcode install only
    breaks the QR, never the page."""
    try:
        import base64
        import io

        import qrcode

        img = qrcode.make(text, box_size=box_size, border=border)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return ""


def control_url(request, session):
    path = reverse("chalk:control", args=[session.code])
    return request.build_absolute_uri(f"{path}?t={session.token}")


def board_payload(board, session, page):
    return {
        "boardId": str(board.id),
        "title": board.title,
        "surface": board.surface,
        "code": session.code,
        "pageIndex": page.index,
        "pageCount": board.page_count,
    }


# --------------------------------------------------------------------------
# owner views
# --------------------------------------------------------------------------

class BoardListView(LoginRequiredMixin, View):
    template_name = "chalk/board_list.html"

    def get(self, request):
        boards = Board.objects.filter(owner=request.user)
        return render(request, self.template_name, {"boards": boards, "surfaces": SURFACES})

    def post(self, request):
        title = (request.POST.get("title") or "").strip() or "Untitled board"
        surface = request.POST.get("surface")
        if surface not in dict(SURFACES):
            surface = "black"
        board = Board.objects.create(owner=request.user, title=title[:200], surface=surface)
        board.ensure_page(0)
        board.ensure_session()
        return redirect("chalk:stage", pk=board.id)


class BoardStageView(LoginRequiredMixin, View):
    """The projector view. Owner only."""

    template_name = "chalk/stage.html"

    def get(self, request, pk):
        board = get_object_or_404(Board, pk=pk, owner=request.user)
        session = board.ensure_session()
        page = board.ensure_page(session.page_index)
        join = control_url(request, session)
        ctx = {
            "board": board,
            "session": session,
            "page": page,
            "join_url": join,
            "qr": qr_data_uri(join),
            "surfaces": SURFACES,
            "config": {
                **board_payload(board, session, page),
                "role": "stage",
                "token": session.token,
                "strokes": page.strokes,
            },
        }
        return render(request, self.template_name, ctx)


class BoardSettingsView(LoginRequiredMixin, View):
    def post(self, request, pk):
        board = get_object_or_404(Board, pk=pk, owner=request.user)
        action = request.POST.get("action")
        if action == "delete":
            board.delete()
            return redirect("chalk:boards")
        title = (request.POST.get("title") or "").strip()
        if title:
            board.title = title[:200]
        surface = request.POST.get("surface")
        if surface in dict(SURFACES):
            board.surface = surface
        board.save(update_fields=["title", "surface", "updated_at"])
        return redirect("chalk:stage", pk=board.id)


class RotateCodeView(LoginRequiredMixin, View):
    """Regenerate the pairing code. Any phone on the old token is kicked."""

    def post(self, request, pk):
        board = get_object_or_404(Board, pk=pk, owner=request.user)
        session = board.ensure_session()
        session.rotate()
        join = control_url(request, session)
        return JsonResponse(
            {
                "ok": True,
                "code": session.code,
                "prettyCode": session.pretty_code,
                "token": session.token,
                "joinUrl": join,
                "qr": qr_data_uri(join),
            }
        )


# --------------------------------------------------------------------------
# phone views
# --------------------------------------------------------------------------

class JoinView(View):
    """Type the number shown on the board."""

    template_name = "chalk/join.html"

    def get(self, request, code=None):
        return render(request, self.template_name, {"code": code or "", "error": None})

    def post(self, request, code=None):
        entered = "".join(ch for ch in (request.POST.get("code") or "") if ch.isdigit())
        session = BoardSession.objects.filter(code=entered).first()
        if not session:
            return render(
                request,
                self.template_name,
                {"code": entered, "error": "No board is using that number. Check the screen and try again."},
            )
        return redirect(f"{reverse('chalk:control', args=[session.code])}?t={session.token}")


class ControlView(View):
    """The phone. Reached by QR (token in the link) or by typing the code.

    Access is by token, not by login, so the teacher can pair a phone that is
    not signed in. The token rotates whenever the code is regenerated.
    """

    template_name = "chalk/control.html"

    def get(self, request, code):
        session = BoardSession.objects.select_related("board").filter(code=code).first()
        if not session:
            raise Http404
        token = request.GET.get("t") or ""
        if token != session.token:
            # Signed-in owner may always drive their own board.
            if not (request.user.is_authenticated and session.board.owner_id == request.user.id):
                return redirect("chalk:join_code", code=code)
            token = session.token
        board = session.board
        page = board.ensure_page(session.page_index)
        ctx = {
            "board": board,
            "session": session,
            "config": {
                **board_payload(board, session, page),
                "role": "control",
                "token": token,
                "strokes": page.strokes,
            },
        }
        return render(request, self.template_name, ctx)
