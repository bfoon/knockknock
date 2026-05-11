from django.urls import path
from . import views

app_name = "presentations"

urlpatterns = [
    path("present/<str:code>/", views.present, name="present"),
    path("join/", views.join_landing, name="join"),
    path("join/<str:code>/", views.join_code, name="join_code"),
    path("qr/<str:code>/", views.qr_png, name="qr"),
    path("sessions/end-all/", views.end_all_sessions, name="end_all_sessions"),
]