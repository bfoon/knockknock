from django.urls import path

from . import views

app_name = "cards"

urlpatterns = [
    # Organiser
    path("", views.my_cards, name="my_cards"),
    path("new/", views.create, name="create"),
    path("c/<str:token>/manage/", views.detail, name="detail"),
    path("c/<str:token>/close/", views.close_card, name="close"),
    path("c/<str:token>/background/", views.update_background, name="update_background"),
    path("c/<str:token>/delete/", views.delete_card, name="delete"),
    path(
        "c/<str:token>/moderate/<int:pk>/",
        views.moderate_message,
        name="moderate",
    ),
    path("c/<str:token>/qr.png", views.qr_code, name="qr"),
    # Public
    path("c/<str:token>/", views.post_message, name="post"),
    path("c/<str:token>/wall/", views.view_card, name="view"),
    path("c/<str:token>/feed/", views.live_messages, name="feed"),
    path("c/<str:token>/react/", views.react, name="react"),
    path("c/<str:token>/download.pdf", views.download_pdf, name="pdf"),
]
