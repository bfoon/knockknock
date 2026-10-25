from django.urls import path

from . import views

app_name = "screenart"

urlpatterns = [
    path("s/<str:token>/upload/", views.upload, name="upload"),
    path("s/<str:token>/settings/", views.settings, name="settings"),
    path("s/<str:token>/<uuid:image_id>/delete/", views.delete, name="delete"),
]
