from django.urls import path
from . import views

app_name = "community"

urlpatterns = [
    path("", views.home, name="home"),
    path("new/", views.topic_create, name="topic_create"),
    path("topic/<int:pk>/", views.topic_detail, name="topic_detail"),
    path("topic/<int:pk>/edit/", views.topic_edit, name="topic_edit"),
    path("topic/<int:pk>/delete/", views.topic_delete, name="topic_delete"),
    path("topic/<int:pk>/like/", views.topic_like_toggle, name="topic_like"),
    path("comment/<int:pk>/delete/", views.comment_delete, name="comment_delete"),
    path("comment/<int:pk>/like/", views.comment_like_toggle, name="comment_like"),
]
