from django.urls import path
from . import views

app_name = "polls"

urlpatterns = [
    path("", views.list_view, name="list"),
    path("new/", views.create, name="create"),

    path("<int:pk>/edit/", views.edit, name="edit"),
    path("<int:pk>/template/", views.set_template, name="set_template"),
    path("<int:pk>/start/", views.start_session, name="start"),
    path("<int:pk>/reorder/", views.reorder_questions, name="reorder"),
    # NEW: delete a whole questionnaire (POST-only). Wired from the dashboard's
    # red trash bin and from the questionnaire list page.
    path("<int:pk>/delete/", views.delete, name="delete"),
    # Duplicate a questionnaire (POST-only) — deep copy of questions,
    # choices, and matrix rows. See polls.views.duplicate() for the
    # full list of what's copied vs reset.
    path("<int:pk>/duplicate/", views.duplicate, name="duplicate"),

    # results / export / reset
    path("<int:pk>/results/", views.questionnaire_results, name="results"),
    path("<int:pk>/results/download/excel/", views.download_results_excel, name="download_results_excel"),
    path("<int:pk>/results/download/word/", views.download_results_word, name="download_results_word"),
    path("<int:pk>/results/reset/", views.reset_results, name="reset_results"),

    # questions
    path("<int:pk>/q/new/", views.question_create, name="question_create"),
    path("<int:pk>/q/<int:qpk>/", views.question_edit, name="question_edit"),
    path("<int:pk>/q/<int:qpk>/delete/", views.question_delete, name="question_delete"),
    path("<int:pk>/q/<int:qpk>/change-type/", views.change_type, name="change_type"),

    # collaboration
    path("<int:pk>/invite/", views.invite_collaborator, name="invite"),
    path("<int:pk>/collab/<int:cpk>/remove/", views.remove_collaborator, name="collab_remove"),

    # quick question actions
    path("<int:pk>/q/quick-add/", views.quick_add_question, name="quick_add_question"),
    path("<int:pk>/q/<int:qpk>/quick-delete/", views.quick_delete_question, name="quick_delete_question"),
]