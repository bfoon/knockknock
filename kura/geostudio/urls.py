"""
kura/geostudio/urls.py — mounted at /kura/geo/ with namespace "kura_geo".

In config/urls.py this include MUST come before the main Kura include:

    path("kura/geo/", include("kura.geostudio.urls", namespace="kura_geo")),
    path("kura/", include("kura.urls", namespace="kura")),
"""

from django.urls import path

from . import views

app_name = "kura_geo"

urlpatterns = [
    path("", views.project_list, name="list"),
    path("new/", views.project_create, name="create"),
    path("survey/<str:code>/", views.from_survey, name="from_survey"),
    path("p/<uuid:pk>/", views.studio, name="studio"),
    path("p/<uuid:pk>/delete/", views.project_delete, name="delete"),
    path("p/<uuid:pk>/report/", views.report, name="report"),
    path("p/<uuid:pk>/api/<slug:action>/", views.api, name="api"),
    path("p/<uuid:pk>/api/<slug:action>/<uuid:oid>/", views.api, name="api_obj"),
    path("r/<str:token>/", views.public_report, name="public_report"),
    path("id/<str:code>/", views.verify, name="verify"),
    path("lookup/<str:code>.json", views.lookup, name="lookup"),
    path("t/<str:token>/", views.tracker_page, name="tracker"),
    path("t/<str:token>/ping/", views.tracker_ping, name="tracker_ping"),
]
