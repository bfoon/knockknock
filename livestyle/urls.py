from django.urls import path

from . import views

app_name = "livestyle"

urlpatterns = [
    path("poll/<int:pk>/charts/", views.poll_charts, name="poll_charts"),
]
