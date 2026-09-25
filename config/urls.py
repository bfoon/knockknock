from django.contrib import admin
from django.urls import path, re_path, include
from django.conf import settings
from django.views.static import serve as media_serve

urlpatterns = [
    path("admin/", admin.site.urls),
    path("accounts/", include("accounts.urls")),
    path("polls/", include("polls.urls")),
    path("games/", include("games.urls")),
    path("live/", include("presentations.urls")),
    path("billing/", include("subscriptions.urls")),
    path("orgs/", include("organizations.urls")),
    path("collab/", include("collaborations.urls")),
    path("attendance/", include("attendance.urls")),
    path("board/", include("boardly.urls", namespace="boardly")),
    path("hanns/", include("hanns.urls", namespace="hanns")),
    path("quest_rpg/", include("quest_rpg.urls", namespace="quest_rpg")),
    path("cards/", include("cards.urls", namespace="cards")),
    path("kura/", include("kura.urls", namespace="kura")),
    path("icebreakers/", include("icebreakers.urls", namespace="icebreakers")),
    path("community/", include("community.urls")),
    path("chalk/", include("chalk.urls", namespace="chalk")),
]

# ── User-uploaded media (/media/…) ─────────────────────────────────────
# django.conf.urls.static.static() returns [] when DEBUG=False, so in
# production every uploaded file 404'd: pasted Hanns images, images pulled
# out of imported PowerPoints, Kura uploads, etc. Host nginx proxies ALL
# paths to Daphne and the files live in the `media` Docker volume, so Django
# is the only thing that can hand them out. Serve them explicitly instead.
#
# SERVE_MEDIA=False in .env turns this off if nginx is ever given its own
# `location /media/` block pointing at the volume.
#
# Must sit BEFORE core.urls, whose "" include could otherwise swallow it.
if getattr(settings, "SERVE_MEDIA", True):
    _media_prefix = settings.MEDIA_URL.strip("/")
    urlpatterns += [
        re_path(
            rf"^{_media_prefix}/(?P<path>.*)$",
            media_serve,
            {"document_root": settings.MEDIA_ROOT},
        ),
    ]

urlpatterns += [
    path("", include("core.urls")),
]
