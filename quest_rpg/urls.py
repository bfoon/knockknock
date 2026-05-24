from django.urls import path

from . import views

app_name = "quest_rpg"

urlpatterns = [
    path("", views.session_list, name="list"),
    path("new/", views.session_create, name="create"),

    path("<str:code>/edit/", views.session_edit, name="edit"),
    path("<str:code>/save/", views.session_save, name="save"),
    path("<str:code>/present/", views.session_present, name="present"),

    # Public/phone + presenter APIs. Keep these BEFORE the bare <code>/ join route.
    path("<str:code>/state/", views.session_state, name="state"),
    path("<str:code>/team/", views.session_team_join, name="team_join"),
    path("<str:code>/answer/", views.session_answer, name="answer"),
    path("<str:code>/start/", views.session_start, name="start"),
    path("<str:code>/goto/", views.session_goto, name="goto"),
    path("<str:code>/reveal/", views.session_reveal, name="reveal"),
    path("<str:code>/reset/", views.session_reset_scores, name="reset"),
    path("<str:code>/delete/", views.session_delete, name="delete"),
    path("<str:code>/end/", views.session_end, name="end"),

    # Audience phone join page — catch-all last.
    path("<str:code>/", views.session_join, name="join"),
]
