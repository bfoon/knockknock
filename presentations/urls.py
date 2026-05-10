from django.urls import path
from . import views

app_name = "presentations"

urlpatterns = [
    path("join/",                  views.join_landing, name="join"),
    path("join/<str:code>/",       views.join_code,    name="join_code"),
    path("qr/<str:code>.png",      views.qr_png,       name="qr"),
    path("present/<str:code>/",    views.present,      name="present"),
]
