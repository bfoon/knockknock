from django.urls import path

from . import views

app_name = "chalk"

urlpatterns = [
    path("", views.BoardListView.as_view(), name="boards"),
    path("b/<uuid:pk>/", views.BoardStageView.as_view(), name="stage"),
    path("b/<uuid:pk>/settings/", views.BoardSettingsView.as_view(), name="settings"),
    path("b/<uuid:pk>/code/", views.RotateCodeView.as_view(), name="rotate_code"),
    path("join/", views.JoinView.as_view(), name="join"),
    path("join/<str:code>/", views.JoinView.as_view(), name="join_code"),
    path("c/<str:code>/", views.ControlView.as_view(), name="control"),
]
