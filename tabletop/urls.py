from django.urls import path

from . import views

app_name = "tabletop"

urlpatterns = [
    path("", views.NightListView.as_view(), name="list"),
    path("n/<uuid:pk>/", views.StageView.as_view(), name="stage"),
    path("n/<uuid:pk>/delete/", views.DeleteView.as_view(), name="delete"),
    path("join/", views.JoinView.as_view(), name="join"),
    path("join/<str:code>/", views.JoinView.as_view(), name="join_code"),
    path("p/<str:code>/", views.PlayView.as_view(), name="play"),
    path("watch/<str:code>/", views.WatchView.as_view(), name="watch"),
]
