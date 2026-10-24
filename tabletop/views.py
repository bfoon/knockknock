import base64
import io
import re

from django.contrib import messages
from django.contrib.auth.mixins import LoginRequiredMixin
from django.http import Http404
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.views import View

from games.avatars import AVATARS, avatars_grouped

from . import services
from .engines import ENGINES
from .models import GameNight, Player

COOKIE_AGE = 60 * 60 * 14  # a long evening
_CODE_RE = re.compile(r"^\d{6}$")


def qr_data_uri(text):
    try:
        import qrcode
        img = qrcode.make(text, box_size=10, border=2)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return ""


def _cookie(code):
    return f"tt_{code}"


def _games():
    return [{"key": k, **m.META} for k, m in ENGINES.items()]


class NightListView(LoginRequiredMixin, View):
    def get(self, request):
        nights = GameNight.objects.filter(owner=request.user)[:50]
        return render(request, "tabletop/list.html", {"nights": nights, "games": _games()})

    def post(self, request):
        game = request.POST.get("game")
        night = GameNight.objects.create(
            owner=request.user,
            title=(request.POST.get("title") or "Game Night").strip()[:120] or "Game Night",
            game=game if game in ENGINES else "chess",
        )
        return redirect("tabletop:stage", pk=night.pk)


class StageView(LoginRequiredMixin, View):
    def get(self, request, pk):
        night = get_object_or_404(GameNight, pk=pk, owner=request.user)
        join_url = request.build_absolute_uri(reverse("tabletop:join_code", args=[night.code]))
        return render(request, "tabletop/stage.html", {
            "night": night, "join_url": join_url, "qr": qr_data_uri(join_url),
            "games": _games(), "avatars": AVATARS,
        })


class DeleteView(LoginRequiredMixin, View):
    def post(self, request, pk):
        night = get_object_or_404(GameNight, pk=pk, owner=request.user)
        night.delete()
        messages.success(request, "Game night deleted.")
        nxt = request.POST.get("next")
        if nxt and nxt.startswith("/") and not nxt.startswith("//"):
            return redirect(nxt)
        return redirect("tabletop:list")


class JoinView(View):
    """Phone entry: type the code, pick a name, build a hero."""

    def get(self, request, code=None):
        night = None
        if code:
            code = code.replace(" ", "")
            night = GameNight.objects.filter(code=code).first()
            if night and request.COOKIES.get(_cookie(code)):
                if Player.objects.filter(night=night, token=request.COOKIES[_cookie(code)],
                                         kicked=False).exists():
                    return redirect("tabletop:play", code=code)
        return render(request, "tabletop/join.html", {
            "night": night, "code": code or "", "avatar_groups": avatars_grouped(),
            "games": _games(), "avatars": AVATARS,
        })

    def post(self, request, code=None):
        code = (request.POST.get("code") or code or "").replace(" ", "")
        if not _CODE_RE.match(code):
            messages.error(request, "That code should be six digits.")
            return redirect("tabletop:join")
        night = GameNight.objects.filter(code=code).first()
        if not night:
            messages.error(request, "No game night with that code.")
            return redirect("tabletop:join")
        if not request.POST.get("name"):
            return redirect("tabletop:join_code", code=code)
        try:
            player = services.join(night, request.POST.get("name"), request.POST.get("avatar_id"))
        except ValueError as e:
            messages.error(request, str(e))
            return redirect("tabletop:join_code", code=code)
        resp = redirect("tabletop:play", code=code)
        resp.set_cookie(_cookie(code), player.token, max_age=COOKIE_AGE,
                        samesite="Lax", httponly=True, secure=request.is_secure())
        return resp


class PlayView(View):
    def get(self, request, code):
        night = GameNight.objects.filter(code=code).first()
        if not night:
            raise Http404("No such game night")
        token = request.COOKIES.get(_cookie(code), "")
        player = Player.objects.filter(night=night, token=token, kicked=False).first() if token else None
        if not player:
            return redirect("tabletop:join_code", code=code)
        return render(request, "tabletop/play.html", {
            "night": night, "player": player, "token": player.token, "role": "player",
            "avatars": AVATARS,
        })


class WatchView(View):
    """Spectator phone: no seat, sees every table live."""

    def get(self, request, code):
        night = GameNight.objects.filter(code=code).first()
        if not night:
            raise Http404("No such game night")
        return render(request, "tabletop/play.html", {
            "night": night, "player": None, "token": "", "role": "watch",
            "avatars": AVATARS,
        })
