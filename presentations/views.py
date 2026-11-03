import io

import qrcode
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.http import Http404, HttpResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.utils.http import url_has_allowed_host_and_scheme
from django.views.decorators.http import require_GET, require_POST

from django.db import DatabaseError, transaction

from core.templates_registry import get_template, public_themes
from games.avatars import AVATARS, avatars_grouped
from .models import LiveSession, Participant, SessionRound, unused_code
from .permissions import can_present


# ─────────────────────────── helpers ───────────────────────────

def _logo_url_for(session):
    """Return the live URL of the session's logo, or None."""
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
    """Return chart background id for the live chart wrapper."""
    if session.kind == "game" and getattr(session, "quiz", None):
        return getattr(session.quiz, "chart_background", "normal") or "normal"

    return "normal"


def _safe_redirect_target(request):
    """
    Redirect back to the previous page after POST.
    Falls back to dashboard/home safely.
    """
    next_url = request.POST.get("next") or request.META.get("HTTP_REFERER") or "/"

    is_safe = url_has_allowed_host_and_scheme(
        next_url,
        allowed_hosts={request.get_host()},
        require_https=request.is_secure(),
    )

    return next_url if is_safe else "/"


def _broadcast_ended_to_sessions(sessions):
    """
    Notify any open presenter/participant browsers that these sessions ended.
    This mirrors the WebSocket 'ended' message already used by the current
    single-session end button.
    """
    channel_layer = get_channel_layer()

    if not channel_layer:
        return

    for session in sessions:
        async_to_sync(channel_layer.group_send)(
            f"session_{session.code}",
            {
                "type": "broadcast",
                "payload": {
                    "type": "ended",
                    "reason": "ended_all_sessions",
                },
            },
        )


# ─────────────────────────── presenter / join ───────────────────────────

def _round_no(session):
    """2, 3, … when this code has been played before; None for the first round."""
    try:
        with transaction.atomic():
            n = SessionRound.objects.filter(played_code=session.code, session__owner=session.owner).count()
    except DatabaseError:
        return None
    return n + 1 if n else None


def _presentable_or_404(request, code):
    """The session, if this user may present it (owner or an editor)."""
    session = get_object_or_404(
        LiveSession.objects.select_related("questionnaire", "quiz"), code=code,
    )
    if not can_present(request.user, session):
        raise Http404
    return session


@login_required
def present(request, code):
    session = _presentable_or_404(request, code)

    template = get_template(session.template_id)

    join_url = short_join_url(request, session.code)

    return render(request, "presentations/present.html", {
        "join_host": request.get_host(),
        "session": session,
        "round_no": _round_no(session),
        "template": template,
        "logo_url": _logo_url_for(session),
        "chart_background": _chart_background_for(session),
        "join_url": join_url,
        "avatars": AVATARS,
        "avatar_groups": avatars_grouped(),
        "themes": public_themes(),
    })


@login_required
@require_POST
def replay(request, code):
    """Replay an ended (or any) session.

    Two modes, chosen by POST flag `fresh`:

      • REOPEN (default): rewind THIS session back to the lobby and present it
        again. Existing responses and participants are kept, so the live charts
        immediately show the accumulated results as you advance — and the
        results page is unaffected. Good for "show the room the results again"
        or continuing where you left off.

      • FRESH (`fresh=1`): create a NEW session (new join code) for the same
        questionnaire/quiz. The old session stays ended and its results stay
        frozen on the results page; the new run collects answers separately.
        Good for re-running the same deck with a new audience.

    Either way you land on the presenter screen.
    """
    session = _presentable_or_404(request, code)

    how = (request.POST.get("how") or "").strip().lower()
    fresh = (request.POST.get("fresh") or "").strip().lower() in {"1", "true", "yes", "on"}

    if how == "restart":
        return _restart_same_code(request, session)

    if fresh or how == "new_code":
        # Spin up a brand-new session for the same content. A new `code` is
        # auto-generated by the model default; results from `session` remain
        # intact and viewable.
        new_session = LiveSession.objects.create(
            owner=session.owner,
            kind=session.kind,
            mode=session.mode,
            questionnaire=session.questionnaire,
            quiz=session.quiz,
            state="lobby",
            current_question_index=-1,
        )
        messages.success(
            request,
            f"Started a fresh replay (new code {new_session.code}). "
            f"The previous results are still saved.",
        )
        return redirect("presentations:present", code=new_session.code)

    # REOPEN this session: rewind to the lobby, keep all data.
    session.state = "lobby"
    session.current_question_index = -1
    session.ended_at = None
    session.question_started_at = None
    session.time_extension_seconds = 0
    session.save(update_fields=[
        "state", "current_question_index", "ended_at",
        "question_started_at", "time_extension_seconds",
    ])

    # Tell any open presenter/participant browsers to refresh into the lobby.
    channel_layer = get_channel_layer()
    if channel_layer:
        async_to_sync(channel_layer.group_send)(
            f"session_{session.code}",
            {
                "type": "broadcast",
                "payload": {"type": "replay", "code": session.code},
            },
        )

    messages.success(request, "Session reopened — existing results are kept.")
    return redirect("presentations:present", code=session.code)


# ─────────────────────────── play again, same code ───────────────────────────

def played_code_of(session):
    """The code players used for this session (archived rounds remember it)."""
    try:
        with transaction.atomic():
            r = SessionRound.objects.filter(session=session).first()
    except DatabaseError:
        return session.code
    return r.played_code if r else session.code


def annotate_rounds(sessions):
    """
    For results pages: set .played_code and .round_no on each session, so
    a restarted code reads "834920, round 2" rather than the internal code
    an earlier round was moved to. Quietly does nothing if the
    SessionRound table hasn't been migrated yet.
    """
    sessions = list(sessions)
    for s in sessions:
        s.played_code, s.round_no, s.is_earlier_round = s.code, None, False
    try:
        with transaction.atomic():
            rounds = {r.session_id: r for r in SessionRound.objects.filter(session__in=sessions)}
    except DatabaseError:
        return sessions
    for s in sessions:
        if s.pk in rounds:
            s.played_code, s.is_earlier_round = rounds[s.pk].played_code, True
    # Number the rounds of each code, oldest first.
    by_code = {}
    for s in sorted(sessions, key=lambda x: x.created_at):
        by_code.setdefault(s.played_code, []).append(s)
    for runs in by_code.values():
        if len(runs) > 1:
            for n, s in enumerate(runs, 1):
                s.round_no = n
    return sessions


def _restart_same_code(request, session):
    """
    Fresh start on the code players already know: same link, same QR,
    same 6 digits, nobody has joined yet and every score is zero.

    Whatever session holds that code now (this one, or a later round of
    it) is moved aside to a new internal code and remembered as an earlier
    round, with its answers and scores untouched — its results and
    exports keep working. Then a new lobby takes the code. Players still on
    the old round are told to hop over; their phones rejoin with the same
    name and avatar.
    """
    code = played_code_of(session)
    try:
        with transaction.atomic():
            holder = (LiveSession.objects.select_for_update()
                      .filter(code=code).first())
            if holder and holder.owner_id != session.owner_id:
                messages.error(request, "That code is in use by someone else now. "
                                        "Use “Play again with a new code” instead.")
                return redirect(_safe_redirect_target(request))
            if holder:
                holder.code = unused_code()
                if holder.state != "ended":
                    holder.state = "ended"
                    holder.ended_at = timezone.now()
                holder.save(update_fields=["code", "state", "ended_at"])
                SessionRound.objects.update_or_create(
                    session=holder, defaults={"played_code": code})
            fresh = LiveSession.objects.create(
                code=code,
                owner=session.owner,     # an editor plays it again for the owner
                kind=session.kind,
                mode=session.mode,
                questionnaire=session.questionnaire,
                quiz=session.quiz,
                state="lobby",
                current_question_index=-1,
            )
            round_no = SessionRound.objects.filter(played_code=code, session__owner=session.owner).count() + 1
    except DatabaseError:
        messages.error(request, "Play again isn’t set up on this server yet: run "
                                "“python manage.py makemigrations presentations” and "
                                "“python manage.py migrate”, then try again.")
        return redirect(_safe_redirect_target(request))

    channel_layer = get_channel_layer()
    if channel_layer:
        def tell_room():
            async_to_sync(channel_layer.group_send)(
                f"session_{code}",
                {"type": "broadcast",
                 "payload": {"type": "restart", "code": code, "round": round_no}},
            )
        transaction.on_commit(tell_room)

    messages.success(request, f"Round {round_no} is ready on the same code, {code}. "
                              f"Earlier rounds’ results are still saved.")
    return redirect("presentations:present", code=fresh.code)


def join_landing(request):
    """
    The join page: type the 6-digit number. Also handles the form being
    submitted without JavaScript (?code=…), and an old /join/ link.
    """
    code = "".join(ch for ch in (request.GET.get("code") or "") if ch.isdigit())[-6:]
    if len(code) == 6:
        return redirect("join_short", code=code)
    return render(request, "presentations/join.html", {"code": code})


@require_GET
def session_status(request, code):
    """
    Tiny public check used by the waiting-room page: is this code live
    again? No names, no answers — only what the join link already reveals.
    """
    from django.http import JsonResponse
    s = LiveSession.objects.filter(code=code).only("pk", "state").first()
    data = {"exists": bool(s), "state": s.state if s else None, "session_id": s.pk if s else None}
    return JsonResponse(data, headers={"Cache-Control": "no-store"})


def short_join_url(request, code):
    """https://<host>/<code> — the link and QR players use."""
    return request.build_absolute_uri(reverse("join_short", args=[code]))


def join_code(request, code):
    """Participant joining via code or QR."""
    try:
        session = (
            LiveSession.objects
            .select_related("questionnaire", "quiz")
            .get(code=code)
        )
    except LiveSession.DoesNotExist:
        return render(request, "presentations/join.html", {
            "error": "Session not found.",
        })

    if session.state == "ended":
        # Not a dead end: keep the page open and it rejoins by itself if
        # the host reopens the session or starts a fresh round on this
        # code ("Play again"). Name and avatar are remembered on the phone.
        return render(request, "presentations/ended_wait.html", {
            "session": session,
            "status_url": reverse("presentations:status", args=[session.code]),
        })

    common = {
        "session": session,
        "template": get_template(session.template_id),
        "logo_url": _logo_url_for(session),
        "chart_background": _chart_background_for(session),
        "avatars": AVATARS,
        "avatar_groups": avatars_grouped(),
        "themes": public_themes(),
    }

    if session.kind == "game":
        return render(request, "presentations/play_game.html", common)

    return render(request, "presentations/play_poll.html", common)


@require_GET
def qr_png(request, code):
    """Serve a PNG QR code linking to the join URL."""
    if not LiveSession.objects.filter(code=code).exists():
        raise Http404

    # The short link: fewer characters means a simpler QR that cheap
    # phone cameras read from further away.
    url = short_join_url(request, code)

    img = qrcode.make(url, box_size=10, border=2)
    buf = io.BytesIO()
    img.save(buf, format="PNG")

    return HttpResponse(buf.getvalue(), content_type="image/png")


# ─────────────────────────── end all sessions ───────────────────────────

@login_required
@require_POST
def end_all_sessions(request):
    """
    End active sessions owned by the current user.

    POST kind values:
      - all  = end active poll + game sessions
      - poll = end active poll sessions only
      - game = end active game sessions only

    This does NOT delete results, answers, participants, or scores.
    It only marks sessions as ended.
    """
    kind = (request.POST.get("kind") or "all").strip().lower()

    if kind not in {"all", "poll", "game"}:
        return HttpResponse("Invalid session type.", status=400)

    sessions_qs = LiveSession.objects.filter(
        owner=request.user,
        state__in=["lobby", "running"],
    )

    if kind != "all":
        sessions_qs = sessions_qs.filter(kind=kind)

    sessions = list(sessions_qs.only("id", "code", "kind", "state"))
    session_ids = [session.id for session in sessions]

    if session_ids:
        LiveSession.objects.filter(pk__in=session_ids).update(
            state="ended",
            ended_at=timezone.now(),
        )

        _broadcast_ended_to_sessions(sessions)

    if kind == "all":
        label = "poll and game"
    elif kind == "poll":
        label = "poll"
    else:
        label = "game"

    messages.success(
        request,
        f"Ended {len(session_ids)} active {label} session"
        f"{'' if len(session_ids) == 1 else 's'}.",
    )

    return redirect(_safe_redirect_target(request))