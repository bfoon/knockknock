from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static

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

    # Boardly — mounted under its own "board/" prefix so it can't collide
    # with core.urls (which also lives at "").  With this prefix the
    # boardly/urls.py routes become e.g. /board/new/, /board/<code>/.
    path("board/", include("boardly.urls", namespace="boardly")),

    path("icebreakers/", include("icebreakers.urls", namespace="icebreakers")),

    # core.urls owns "" (home, dashboard, join) — keep it LAST so its
    # patterns are only tried after every prefixed app above.
    path("", include("core.urls")),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)