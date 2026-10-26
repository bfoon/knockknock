"""Menti polls and games on a Hanns Big Screen.

Flow
----
1. A presenter, on their live session's presenter screen, taps "Big screen"
   and types the screen's share code (the same code decks use). The session
   lands in that screen's lobby as *waiting*.
2. The big screen host (projector panel or Big screens dashboard) puts it on
   air: the projector shows the live session full screen (display only — a
   read-only viewer of the session).
3. The host drives it from the big screen: next, back, reveal answer, +30 s,
   end. These run the live session's OWN presenter handlers (the same code a
   presenter's button runs), so behaviour can't drift between the two.

Security: sharing needs the session's owner to be signed in; the big screen
side uses the screen's token as its credential, like every Big Screen action;
a share only ever drives the one session it names.
"""

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from .models import ScreenLiveShare

ACTIONS = ("next", "back", "reveal", "extend", "end", "restart")


class LiveError(ValueError):
    pass


def _session(pk):
    from presentations.models import LiveSession
    return LiveSession.objects.select_related("questionnaire", "quiz").filter(pk=pk).first()


def share(user, session_code, screen_code):
    """Presenter sends their live session to a big screen. Returns (share, screen)."""
    from hanns.models import BigScreen
    from presentations.models import LiveSession

    session = LiveSession.objects.select_related("questionnaire", "quiz").filter(code=str(session_code)).first()
    if not session or session.owner_id != user.pk:
        raise LiveError("Only the presenter of this session can send it to a big screen.")
    code = "".join(ch for ch in str(screen_code or "") if ch.isdigit())
    screen = BigScreen.objects.filter(share_code=code, is_active=True).first() if len(code) == 6 else None
    if not screen:
        raise LiveError("No big screen has that code — check the six digits on the projector.")
    s, created = ScreenLiveShare.objects.get_or_create(
        screen_id=screen.id, session_pk=session.pk,
        defaults=dict(session_code=session.code, kind=session.kind, title=session.title[:200], owner_id=user.pk,
                      owner_name=(user.get_full_name() or user.get_username())[:150]))
    if not created:
        s.title = session.title[:200]
        s.save(update_fields=["title"])
    return s, screen


def unshare(user, session_code):
    """Presenter takes their session back off every big screen. Returns screen ids touched."""
    rows = ScreenLiveShare.objects.filter(session_code=str(session_code), owner_id=user.pk)
    ids = list(rows.values_list("screen_id", flat=True).distinct())
    rows.delete()
    return ids


def live_for(screen_id):
    """The `live` entry of the Big Screen snapshot."""
    out, on_air = [], None
    for s in ScreenLiveShare.objects.filter(screen_id=screen_id):
        session = _session(s.session_pk)
        if not session:
            s.delete()                                  # the session itself was deleted
            continue
        total = len(session.questions())
        row = {"id": str(s.id), "kind": s.kind, "title": session.title, "code": s.session_code,
               "owner": s.owner_name, "status": s.status, "state": session.state,
               "index": session.current_question_index if session.state == "running" else None, "total": total}
        out.append(row)
        if s.status == "onair":
            on_air = row["id"]
    return {"shares": out, "on_air": on_air}


def set_on_air(screen_id, share_id, on):
    share = ScreenLiveShare.objects.filter(screen_id=screen_id, pk=share_id).first()
    if not share:
        raise LiveError("That session is no longer shared with this screen.")
    if on:
        ScreenLiveShare.objects.filter(screen_id=screen_id, status="onair").exclude(pk=share.pk).update(status="waiting")
    share.status = "onair" if on else "waiting"
    share.save(update_fields=["status"])
    return share


def remove(screen_id, share_id):
    return ScreenLiveShare.objects.filter(screen_id=screen_id, pk=share_id).delete()[0] > 0


class _Driver:
    """Runs presentations.consumers.SessionConsumer's presenter handlers for a
    session without a websocket: the same validation, state changes and
    broadcasts as when the presenter presses the button."""

    def __init__(self, session):
        from presentations.consumers import SessionConsumer
        c = SessionConsumer()
        c.code = session.code
        c.group = f"session_{session.code}"
        c.role = "presenter"
        c.uid = "bigscreen"
        c.session_pk = session.pk
        c.self_index = None
        c.channel_layer = get_channel_layer()
        c.channel_name = "bigscreen-driver"

        async def _quiet(*a, **k):                    # it has no socket of its own to answer
            return None
        c.send_json = _quiet
        self.c = c

    async def run(self, action):
        c = self.c
        if action == "next":
            await c._on_advance({})
        elif action == "back":
            await c._on_back({})
        elif action == "reveal":
            await c._on_reveal_answer({})
        elif action == "extend":
            await c._on_extend_time({"seconds": 30})
        elif action == "end":
            await c._on_end({})
        elif action == "restart":
            await c._on_goto({"index": 0})


def control(screen_id, share_id, action):
    if action not in ACTIONS:
        raise LiveError("Unknown action.")
    share = ScreenLiveShare.objects.filter(screen_id=screen_id, pk=share_id).first()
    if not share:
        raise LiveError("That session is no longer shared with this screen.")
    session = _session(share.session_pk)
    if not session:
        share.delete()
        raise LiveError("That live session no longer exists.")
    async_to_sync(_Driver(session).run)(action)
    return _session(share.session_pk)


def delete_all(screen_id):
    ScreenLiveShare.objects.filter(screen_id=screen_id).delete()
