from django.urls import path
from . import views

app_name = "games"

urlpatterns = [
    path("", views.list_view, name="list"),
    path("new/", views.create, name="create"),
    path("<int:pk>/edit/", views.edit, name="edit"),
    path("<int:pk>/start/", views.start_session, name="start"),
    # NEW: delete a whole quiz (POST-only). Wired from the dashboard's red bin.
    path("<int:pk>/delete/", views.delete, name="delete"),
    # Duplicate a quiz (POST-only) — deep copy of questions, choices, rooms.
    path("<int:pk>/duplicate/", views.duplicate, name="duplicate"),
    path("<int:pk>/q/new/", views.question_create, name="question_create"),
    path("<int:pk>/q/<int:qpk>/", views.question_edit, name="question_edit"),
    path("<int:pk>/q/<int:qpk>/delete/", views.question_delete, name="question_delete"),
    path("<int:pk>/q/reorder/", views.question_reorder, name="question_reorder"),
    path("<int:pk>/results/", views.results, name="results"),
    path("<int:pk>/results/<int:session_id>/excel/", views.export_session_excel, name="export_excel"),
    path("<int:pk>/results/<int:session_id>/word/", views.export_session_word, name="export_word"),
]