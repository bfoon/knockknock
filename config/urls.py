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
    path("", include("core.urls")),
    path("billing/", include("subscriptions.urls")),
    path("orgs/", include("organizations.urls")),
    path("collab/", include("collaborations.urls")),
    path("attendance/", include("attendance.urls")),
    path("icebreakers/", include("icebreakers.urls", namespace="icebreakers"))
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
