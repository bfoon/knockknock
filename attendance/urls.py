from django.urls import path
from . import views

app_name = "attendance"

urlpatterns = [
    # ── Organizer ────────────────────────────────────────────
    path("",                                views.event_list,           name="event_list"),
    path("new/",                            views.event_create,         name="event_create"),
    path("<int:pk>/",                       views.event_detail,         name="event_detail"),
    path("<int:pk>/edit/",                  views.event_edit,           name="event_edit"),
    path("<int:pk>/form/",                  views.form_builder,         name="form_builder"),
    path("<int:pk>/status/",                views.event_set_status,     name="event_set_status"),
    # NEW: delete an event (POST-only). Wired from the dashboard's red bin.
    path("<int:pk>/delete/",                views.event_delete,         name="event_delete"),
    path("<int:pk>/export.csv",             views.registrations_export, name="export_csv"),
    path("<int:pk>/certificates/bulk/",     views.certificates_bulk,    name="certificates_bulk"),
    path("<int:pk>/certificates/<int:reg_id>/", views.certificate_download, name="certificate_download"),
    path("<int:pk>/announce/",              views.announcement_send,    name="announcement_send"),
    path("<int:pk>/r/<int:reg_id>/action/", views.registration_action,  name="registration_action"),

    # Form-builder AJAX
    path("<int:pk>/fields/add-preset/",       views.field_add_preset, name="field_add_preset"),
    path("<int:pk>/fields/add-custom/",       views.field_add_custom, name="field_add_custom"),
    path("<int:pk>/fields/reorder/",          views.field_reorder,    name="field_reorder"),
    path("<int:pk>/fields/<int:field_id>/",   views.field_edit,       name="field_edit"),
    path("<int:pk>/fields/<int:field_id>/delete/", views.field_delete, name="field_delete"),

    # ── Public attendee paths (short for SMS / printing) ─────
    path("e/<str:public_token>/",        views.public_register,  name="public_register"),
    path("e/<str:public_token>/qr.png",  views.public_qr,        name="public_qr"),
    path("e/<str:public_token>/checkin/", views.public_check_in, name="public_check_in"),

    path("t/<uuid:token>/",          views.ticket,             name="ticket"),
    path("t/<uuid:token>/qr.png",    views.ticket_qr,          name="ticket_qr"),
    path("t/<uuid:token>/checkin/",  views.attendee_check_in,  name="attendee_check_in"),
]