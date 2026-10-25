from django.urls import path

from . import views

app_name = "designlib"

urlpatterns = [
    path("", views.bookmarks, name="list"),
    path("<int:pk>/", views.bookmark, name="item"),
    path("<int:pk>/delete/", views.delete, name="delete"),
]
