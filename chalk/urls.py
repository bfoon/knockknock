from django.urls import path, register_converter

from . import lab, link, parts, power, views


class CodeConverter:
    """Digits only, 6-10 of them. Keeps garbage out of the view and stops
    `/c/<anything>/` becoming a database lookup."""

    regex = r"\d{6,10}"

    def to_python(self, value):
        return value

    def to_url(self, value):
        return str(value)


register_converter(CodeConverter, "boardcode")


class LinkKeyConverter:
    """A Chalk Link key: ck_ and 32 url-safe characters."""

    regex = r"ck_[A-Za-z0-9_-]{20,60}"

    def to_python(self, value):
        return value

    def to_url(self, value):
        return str(value)


register_converter(LinkKeyConverter, "linkkey")

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
    # Circuit Lab: a workbench per board. Owner-only, like the projector.
    path("b/<uuid:pk>/lab/", lab.LabView.as_view(), name="lab"),
    # the parts you design in the lab's part designer: yours, on every board
    path("lab/parts/", parts.PartsView.as_view(), name="lab_parts"),
    path("b/<uuid:pk>/lab/save/", lab.LabSaveView.as_view(), name="lab_save"),
    path("b/<uuid:pk>/lab/ai/", lab.LabAIView.as_view(), name="lab_ai"),
    path("b/<uuid:pk>/lab/pin/", lab.LabPinView.as_view(), name="lab_pin"),
    path("b/<uuid:pk>/lab/<uuid:cid>/", lab.LabView.as_view(), name="lab_open"),
    path("b/<uuid:pk>/lab/<uuid:cid>/delete/", lab.LabDeleteView.as_view(), name="lab_delete"),
    # Power Lab: building wiring and solar, one size up from the Circuit Lab.
    path("b/<uuid:pk>/power/", power.PowerView.as_view(), name="power"),
    path("b/<uuid:pk>/power/save/", power.PowerSaveView.as_view(), name="power_save"),
    path("b/<uuid:pk>/power/ai/", power.PowerAIView.as_view(), name="power_ai"),
    path("b/<uuid:pk>/power/<uuid:plan_id>/", power.PowerView.as_view(), name="power_open"),
    path("b/<uuid:pk>/power/<uuid:plan_id>/delete/", power.PowerDeleteView.as_view(), name="power_delete"),
    # Chalk Link: the board's HTTP API. The first line is the owner opening or
    # rotating it; the rest are public to whoever holds the key (chalk/link.py).
    path("b/<uuid:pk>/link/", link.LinkManageView.as_view(), name="link_manage"),
    path("api/link/<linkkey:key>/", link.info, name="link_api"),
    path("api/link/<linkkey:key>/tags/", link.tags, name="link_tags"),
    path("api/link/<linkkey:key>/tags/<str:name>/", link.tag, name="link_tag"),
    path("api/link/<linkkey:key>/set/", link.set_from_url, name="link_set"),
    path("api/link/<linkkey:key>/events/", link.events, name="link_events"),
]
