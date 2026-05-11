from django.urls import path
from . import views

app_name = "organizations"

urlpatterns = [
    path("create/", views.create_organization, name="create"),
    path("<int:org_id>/members/", views.members, name="members"),
    path("<int:org_id>/members/<int:membership_id>/role/", views.change_role, name="change_role"),
    path("<int:org_id>/members/<int:membership_id>/remove/", views.remove_member, name="remove_member"),
]
