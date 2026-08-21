from django.urls import path, register_converter

from . import views


class CodeConverter:
    """Digits only, 6-10 of them. Keeps garbage out of the view and stops
    `/c/<anything>/` becoming a database lookup."""

    regex = r"\d{6,10}"

    def to_python(self, value):
        return value

    def to_url(self, value):
        return str(value)


register_converter(CodeConverter, "boardcode")

app_name = "chalk"

urlpatterns = [
    path("", views.BoardListView.as_view(), name="boards"),
    path("b/<uuid:pk>/", views.BoardStageView.as_view(), name="stage"),
    path("b/<uuid:pk>/settings/", views.BoardSettingsView.as_view(), name="settings"),
    path("b/<uuid:pk>/code/", views.RotateCodeView.as_view(), name="rotate_code"),
    path("b/<uuid:pk>/upload/", views.UploadImageView.as_view(), name="upload"),
    # Photos are served by the app rather than by MEDIA_URL, so a board that
    # is running at all is a board whose photos appear. See views.BoardImageView.
    path(
        "b/<uuid:pk>/img/<uuid:image_id>/",
        views.BoardImageView.as_view(),
        name="image",
    ),
    path("join/", views.JoinView.as_view(), name="join"),
    path("join/<boardcode:code>/", views.JoinView.as_view(), name="join_code"),
    path("c/<boardcode:code>/", views.ControlView.as_view(), name="control"),
]
