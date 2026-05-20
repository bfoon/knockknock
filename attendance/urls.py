from django.urls import path
from . import views
from . import venue_views
from . import feedback_views

app_name = "attendance"

urlpatterns = [
    # ── Organizer ────────────────────────────────────────────
    path("",                                views.event_list,           name="event_list"),
    path("new/",                            views.event_create,         name="event_create"),
    path("<int:pk>/",                       views.event_detail,         name="event_detail"),
    path("<int:pk>/edit/",                  views.event_edit,           name="event_edit"),
    path("<int:pk>/form/",                  views.form_builder,         name="form_builder"),
    path("<int:pk>/status/",                views.event_set_status,     name="event_set_status"),
    # POST-only delete wired from the dashboard's red bin.
    path("<int:pk>/delete/",                views.event_delete,         name="event_delete"),
    # Duplicate an event (POST-only) — deep copy of fields and agenda
    # items. See views.event_duplicate for what's copied vs reset.
    path("<int:pk>/duplicate/",             views.event_duplicate,      name="event_duplicate"),
    path("<int:pk>/export.csv",             views.registrations_export, name="export_csv"),

    # Stats feed (JSON) consumed by the dashboard charts
    path("<int:pk>/stats.json",             views.event_stats_json,     name="event_stats_json"),

    # Printable poster wrapping the event QR
    path("<int:pk>/poster/",                views.public_qr_poster,     name="public_qr_poster"),

    # Certificates
    path("<int:pk>/certificates/picker/",   views.certificate_picker,   name="certificate_picker"),
    path("<int:pk>/certificates/preview/",  views.certificate_preview,  name="certificate_preview"),
    path("<int:pk>/certificates/bulk/",     views.certificates_bulk,    name="certificates_bulk"),
    path("<int:pk>/certificates/<int:reg_id>/", views.certificate_download, name="certificate_download"),

    # Agenda
    path("<int:pk>/agenda/",                       views.agenda_editor,       name="agenda_editor"),

    # Day-level routes — multi-day editor. The agenda_editor.html JS
    # hits these via /attendance/<pk>/agenda/days/... . Keep these
    # ABOVE the item-level routes so `days/add/` doesn't get matched
    # as an item_id of "days".
    path("<int:pk>/agenda/days/add/",              views.agenda_day_add,      name="agenda_day_add"),
    path("<int:pk>/agenda/days/reorder/",          views.agenda_day_reorder,  name="agenda_day_reorder"),
    path("<int:pk>/agenda/days/<int:day_id>/",         views.agenda_day_edit,    name="agenda_day_edit"),
    path("<int:pk>/agenda/days/<int:day_id>/delete/",  views.agenda_day_delete,  name="agenda_day_delete"),

    path("<int:pk>/agenda/add/",                   views.agenda_item_add,     name="agenda_item_add"),
    path("<int:pk>/agenda/<int:item_id>/",         views.agenda_item_edit,    name="agenda_item_edit"),
    path("<int:pk>/agenda/<int:item_id>/delete/",  views.agenda_item_delete,  name="agenda_item_delete"),
    path("<int:pk>/agenda/reorder/",               views.agenda_reorder,      name="agenda_reorder"),
    path("<int:pk>/agenda/template/",              views.agenda_set_template, name="agenda_set_template"),
    path("<int:pk>/agenda/preview/",               views.agenda_preview,      name="agenda_preview"),
    # Headless-renderable agenda page. Loaded by services.render_agenda_*
    # under Playwright to produce real PDF / PNG files. Honours
    # ?theme=dark|light so all 10 agenda templates flip palette in one go.
    path("<int:pk>/agenda/print/",                 views.agenda_print,        name="agenda_print"),
    # Actual file download endpoint. ?format=pdf|png&theme=dark|light.
    # Streams the rendered bytes as an attachment — no print dialog.
    path("<int:pk>/agenda/download/",              views.agenda_download,     name="agenda_download"),

    path("<int:pk>/announce/",              views.announcement_send,    name="announcement_send"),
    path("<int:pk>/r/<int:reg_id>/action/", views.registration_action,  name="registration_action"),

    # Form-builder AJAX
    path("<int:pk>/fields/add-preset/",       views.field_add_preset, name="field_add_preset"),
    path("<int:pk>/fields/add-custom/",       views.field_add_custom, name="field_add_custom"),
    path("<int:pk>/fields/reorder/",          views.field_reorder,    name="field_reorder"),
    path("<int:pk>/fields/<int:field_id>/",   views.field_edit,       name="field_edit"),
    path("<int:pk>/fields/<int:field_id>/delete/", views.field_delete, name="field_delete"),

    # ── Venue registry ─────────────────────────────────────────
    # Lives under /attendance/venues/. Free users can hit the list and
    # just see an empty state; create/edit routes 403 if you don't have
    # the right scope. See venue_views.py for the permission gates.
    path("venues/",                     venue_views.venue_list,    name="venue_list"),
    path("venues/new/",                 venue_views.venue_create,  name="venue_create"),
    path("venues/<int:pk>/edit/",       venue_views.venue_edit,    name="venue_edit"),
    path("venues/<int:pk>/delete/",     venue_views.venue_delete,  name="venue_delete"),
    path("venues/site-settings/",       venue_views.site_settings, name="site_settings"),

    # ── Feedback (post-event survey) ─────────────────────────
    # Organizer side: design questions, toggle active, browse results.
    # All gated to event owner; activation also requires event.status==ENDED
    # (enforced in feedback_views.feedback_toggle_active).
    path("<int:pk>/feedback/",                  feedback_views.feedback_editor,          name="feedback_editor"),
    path("<int:pk>/feedback/save/",             feedback_views.feedback_survey_update,   name="feedback_survey_update"),
    path("<int:pk>/feedback/toggle/",           feedback_views.feedback_toggle_active,   name="feedback_toggle_active"),
    path("<int:pk>/feedback/q/add/",            feedback_views.feedback_question_add,    name="feedback_question_add"),
    path("<int:pk>/feedback/q/<int:question_id>/",
                                                feedback_views.feedback_question_edit,   name="feedback_question_edit"),
    path("<int:pk>/feedback/q/<int:question_id>/delete/",
                                                feedback_views.feedback_question_delete, name="feedback_question_delete"),
    path("<int:pk>/feedback/q/reorder/",        feedback_views.feedback_question_reorder, name="feedback_question_reorder"),
    path("<int:pk>/feedback/results/",          feedback_views.feedback_results,         name="feedback_results"),

    # Public-facing survey pages. Two entry points so QR scans don't
    # need to change after the event is marked Ended:
    #   - /e/<token>/feedback/  ← reached from the event-level walk-in QR
    #   - /t/<token>/feedback/  ← reached from a personal ticket QR
    # Both are also linked to automatically from `public_check_in` and
    # `ticket` when the survey is active (see feedback_views.should_route_to_feedback).
    path("e/<str:public_token>/feedback/",      feedback_views.public_feedback_by_token, name="public_feedback_by_token"),
    path("t/<uuid:token>/feedback/",            feedback_views.public_feedback_by_ticket, name="public_feedback_by_ticket"),

    # ── Public attendee paths (short for SMS / printing) ─────
    path("e/<str:public_token>/",        views.public_register,  name="public_register"),
    path("e/<str:public_token>/qr.png",  views.public_qr,        name="public_qr"),
    path("e/<str:public_token>/checkin/", views.public_check_in, name="public_check_in"),

    path("t/<uuid:token>/",          views.ticket,             name="ticket"),
    path("t/<uuid:token>/qr.png",    views.ticket_qr,          name="ticket_qr"),
    path("t/<uuid:token>/checkin/",  views.attendee_check_in,  name="attendee_check_in"),
]