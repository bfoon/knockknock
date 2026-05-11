from django.urls import path
from . import views

app_name = "subscriptions"

urlpatterns = [
    path("pricing/", views.pricing, name="pricing"),
    path("choose/<slug:tier>/", views.choose_plan, name="choose"),
    path("checkout/", views.checkout, name="checkout"),
    path("manage/", views.manage, name="manage"),
    path("cancel/", views.cancel, name="cancel"),
]
