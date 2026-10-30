from django.urls import path

from . import views

app_name = "screenart"

urlpatterns = [
    path("s/<str:token>/upload/", views.upload, name="upload"),
    path("s/<str:token>/settings/", views.settings, name="settings"),
    path("s/<str:token>/<uuid:image_id>/delete/", views.delete, name="delete"),
    # live polls & games
    path("live/share/", views.live_share, name="live_share"),
    path("live/unshare/", views.live_unshare, name="live_unshare"),
    path("s/<str:token>/live/<uuid:share_id>/air/", views.live_air, name="live_air"),
    path("s/<str:token>/live/<uuid:share_id>/control/", views.live_control, name="live_control"),
    path("s/<str:token>/live/<uuid:share_id>/remove/", views.live_remove, name="live_remove"),
    path("s/<str:token>/live/<uuid:share_id>/view/", views.live_view, name="live_view"),
    # music & video, event
    path("s/<str:token>/media/", views.media, name="media"),
    path("s/<str:token>/dj/fx/", views.dj_fx, name="dj_fx"),
    path("s/<str:token>/dj/sample/", views.dj_sample, name="dj_sample"),
    path("s/<str:token>/look/", views.look, name="look"),
    path("s/<str:token>/teams/", views.teams, name="teams"),
    path("s/<str:token>/events/", views.events, name="events"),
    path("s/<str:token>/event/", views.event, name="event"),
    path("s/<str:token>/event/data/", views.event_data, name="event_data"),
    # door screen: the welcome / event-information display outside the room
    path("s/<str:token>/door/", views.door, name="door"),
    path("door/<str:door_token>/", views.door_page, name="door_page"),
    path("door/<str:door_token>/state/", views.door_state, name="door_state"),
]
