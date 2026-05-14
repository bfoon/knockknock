from django.urls import path
from . import views

app_name = "icebreakers"

urlpatterns = [
    path("", views.catalog, name="catalog"),
    path("play/<slug:game_id>/", views.play, name="play"),
]
