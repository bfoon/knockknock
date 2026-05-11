from django.urls import path
from . import views

app_name = "collaborations"

urlpatterns = [
    path("invite/<str:kind>/<int:target_id>/", views.invite, name="invite"),
    path("accept/<str:token>/", views.accept, name="accept"),
]
