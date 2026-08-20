from hmac import compare_digest

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.contrib.auth.mixins import LoginRequiredMixin
from django.db.models import Count
from django.http import Http404, JsonResponse
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.views import View

from . import throttle
from .models import (
    IMAGE_TYPES,
    MAX_IMAGE_BYTES,
    SURFACES,
    Board,
    BoardImage,
    BoardSession,
)

# /join/ limits. Six-to-eight digits is a small enough space that an
# unthrottled POST endpoint is a code-guessing oracle; these numbers are
# generous for a person fat-fingering a number off a projector and hopeless
# for a script.
JOIN_IP_LIMIT = 8
JOIN_IP_WINDOW = 60
JOIN_IP_HOUR_LIMIT = 40
JOIN_IP_HOUR_WINDOW = 3600

# Photo uploads. Generous for a lesson, hopeless as a file dump: a paired
# phone is trusted, but a leaked pairing should not become free storage.
UPLOAD_LIMIT = 20
UPLOAD_WINDOW = 60
UPLOAD_HOUR_LIMIT = 120
UPLOAD_HOUR_WINDOW = 3600


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
        "strokes": page.strokes,
        "els": page.els,
    }


def paired(request, board, session):
    """Is this request allowed to drive this board?

    Same three doors as ControlView: the token in the link, a grant already
    held in this browser's session, or being signed in as the owner.
    """
    token = request.POST.get("t") or request.GET.get("t") or ""
    grants = request.session.get("chalk_grants") or {}
    held = str(grants.get(str(board.id)) or "")
    if bool(token) and compare_digest(token, session.token):
        return True
    if bool(held) and compare_digest(held, session.token):
        return True
    return request.user.is_authenticated and board.owner_id == request.user.id


def grant_control(request, board, session):
    """Remember in this browser's session that it is paired with this board.

    The websocket authenticates from here rather than from a token the page
    has to hand back through JSON. A token that goes browser -> QR -> redirect
    -> template -> JS -> websocket has a lot of places to get lost, and every
    loss looked identical on the phone: "pairing expired".
    """
    grants = request.session.get("chalk_grants") or {}
    grants[str(board.id)] = session.token
    # Keep the dict small — a phone that has paired with many boards over a
    # term should not carry all of them forever.
    if len(grants) > 12:
        grants = dict(list(grants.items())[-12:])
    request.session["chalk_grants"] = grants
    request.session.modified = True


def evict_room(code, reason, code_name="expired"):
    """Kick every socket sitting in the room for `code`.

    Rotating used to leave an already-connected phone in place: the consumer
    read the token once at connect and `_commit_stroke` writes by board id, so
    the revoked phone kept writing into the page with nobody watching.
    """
    layer = get_channel_layer()
    if layer is None:
        return
    async_to_sync(layer.group_send)(
        f"chalk_{code}", {"type": "kick", "reason": reason, "code": code_name}
    )


# --------------------------------------------------------------------------
# owner views
# --------------------------------------------------------------------------

class BoardListView(LoginRequiredMixin, View):
    template_name = "chalk/board_list.html"

    def get(self, request):
        boards = Board.objects.filter(owner=request.user).annotate(
            pages_total=Count("pages")
        )
        return render(
            request, self.template_name, {"boards": boards, "surfaces": SURFACES}
        )

    def post(self, request):
        title = (request.POST.get("title") or "").strip() or "Untitled board"
        surface = request.POST.get("surface")
        if surface not in dict(SURFACES):
            surface = "black"
        board = Board.objects.create(
            owner=request.user, title=title[:200], surface=surface
        )
        board.ensure_page(0)
        board.ensure_session()
        return redirect("chalk:stage", pk=board.id)


class BoardStageView(LoginRequiredMixin, View):
    """The projector view. Owner only."""

    template_name = "chalk/stage.html"

    def get(self, request, pk):
        board = get_object_or_404(Board, pk=pk, owner=request.user)
        session = board.ensure_session()
        if not session.is_live:
            session.extend()
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
                # chalk_stage.js reads both of these for the rotate button.
                # They were missing, so the fetch went to "undefined" with a
                # null CSRF header and the button could never work.
                "rotateUrl": reverse("chalk:rotate_code", args=[board.id]),
                "boardsUrl": reverse("chalk:boards"),
                "csrf": get_token(request),
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
    """Regenerate the pairing code, and actually kick the old phone."""

    def post(self, request, pk):
        board = get_object_or_404(Board, pk=pk, owner=request.user)
        session = board.ensure_session()
        old_code = session.code
        session.rotate()
        evict_room(
            old_code, "This board number was regenerated. Scan the new one.", "expired"
        )
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

class UploadImageView(View):
    """A photo from the phone.

    Authenticated by pairing rather than by login, because the phone driving
    the board usually is not signed in. Everything about the file is checked
    server-side; the element that references it is validated separately when
    it arrives over the websocket.
    """

    def post(self, request, pk):
        board = get_object_or_404(Board, pk=pk)
        session = board.ensure_session()
        if not session.is_live or not paired(request, board, session):
            return JsonResponse(
                {"ok": False, "error": "This phone is not paired with the board."},
                status=403,
            )

        ip = throttle.client_ip(request)
        ok_minute = throttle.hit("upload", ip, UPLOAD_LIMIT, UPLOAD_WINDOW)
        ok_hour = throttle.hit(
            "upload-hr", ip, UPLOAD_HOUR_LIMIT, UPLOAD_HOUR_WINDOW
        )
        if not (ok_minute and ok_hour):
            return JsonResponse(
                {"ok": False, "error": "Too many photos at once. Wait a moment."},
                status=429,
            )

        upload = request.FILES.get("file")
        if not upload:
            return JsonResponse(
                {"ok": False, "error": "No photo arrived."}, status=400
            )
        if upload.size > MAX_IMAGE_BYTES:
            return JsonResponse(
                {"ok": False, "error": "That photo is over 12 MB. Try a smaller one."},
                status=400,
            )
        if upload.content_type not in IMAGE_TYPES:
            return JsonResponse(
                {"ok": False, "error": "That file is not a photo."}, status=400
            )

        # Trust the pixels, not the header. A .png content-type on a zip is
        # one line of curl; Pillow actually parsing it is not.
        try:
            from PIL import Image

            probe = Image.open(upload)
            probe.verify()
            width, height = probe.size
            upload.seek(0)
        except Exception:
            return JsonResponse(
                {"ok": False, "error": "That photo could not be read."}, status=400
            )
        if not width or not height:
            return JsonResponse(
                {"ok": False, "error": "That photo could not be read."}, status=400
            )

        image = BoardImage.objects.create(
            board=board, file=upload, width=width, height=height
        )
        session.extend()
        return JsonResponse(
            {
                "ok": True,
                "src": image.file.url,
                "width": width,
                "height": height,
                "ratio": round(height / width, 4),
            }
        )


class JoinView(View):
    """Type the number shown on the board."""

    template_name = "chalk/join.html"

    def get(self, request, code=None):
        return render(
            request, self.template_name, {"code": code or "", "error": None}
        )

    def post(self, request, code=None):
        entered = "".join(
            ch for ch in (request.POST.get("code") or "") if ch.isdigit()
        )
        ip = throttle.client_ip(request)

        # Throttle before touching the database, so a script gets nothing back
        # that distinguishes a live code from a dead one.
        within_minute = throttle.hit("join-ip", ip, JOIN_IP_LIMIT, JOIN_IP_WINDOW)
        within_hour = throttle.hit(
            "join-ip-hr", ip, JOIN_IP_HOUR_LIMIT, JOIN_IP_HOUR_WINDOW
        )
        if not (within_minute and within_hour):
            return render(
                request,
                self.template_name,
                {
                    "code": "",
                    "error": "Too many tries. Wait a minute and enter the number again.",
                },
                status=429,
            )

        session = (
            BoardSession.objects.select_related("board").filter(code=entered).first()
            if entered
            else None
        )
        if not session or not session.is_live:
            if session is not None:
                # Count the guess against this code. Enough of them and the
                # code rotates itself out from under whoever is guessing.
                session.note_failed_join()
            return render(
                request,
                self.template_name,
                {
                    "code": entered,
                    "error": "No board is using that number. Check the screen and try again.",
                },
                status=404,
            )

        session.extend()
        grant_control(request, session.board, session)
        return redirect(
            f"{reverse('chalk:control', args=[session.code])}?t={session.token}"
        )


class ControlView(View):
    """The phone. Reached by QR (token in the link) or by typing the code.

    Access is by token or by a grant already held in this browser's session,
    not by login, so the teacher can pair a phone that is not signed in.
    Both are invalidated when the code is regenerated.
    """

    template_name = "chalk/control.html"

    def get(self, request, code):
        session = (
            BoardSession.objects.select_related("board").filter(code=code).first()
        )
        if not session:
            raise Http404
        if not session.is_live:
            return redirect("chalk:join")

        board = session.board
        token = request.GET.get("t") or ""
        grants = request.session.get("chalk_grants") or {}
        held = str(grants.get(str(board.id)) or "")

        by_token = bool(token) and compare_digest(token, session.token)
        by_grant = bool(held) and compare_digest(held, session.token)
        by_owner = (
            request.user.is_authenticated and board.owner_id == request.user.id
        )

        if not (by_token or by_grant or by_owner):
            return redirect("chalk:join_code", code=code)

        # Refresh the grant on every successful load. From here on the phone
        # does not need the ?t= parameter to survive anything.
        grant_control(request, board, session)
        session.extend()

        page = board.ensure_page(session.page_index)
        ctx = {
            "board": board,
            "session": session,
            "config": {
                **board_payload(board, session, page),
                "role": "control",
                "token": session.token,
                "joinUrl": reverse("chalk:join"),
                "uploadUrl": reverse("chalk:upload", args=[board.id]),
                # The upload is a POST from the phone, which is usually not
                # signed in, so it needs a CSRF token of its own.
                "csrf": get_token(request),
            },
        }
        return render(request, self.template_name, ctx)
