from django.urls import path
from . import views

app_name = "games"

urlpatterns = [
    path("",                          views.list_view,         name="list"),
    path("new/",                      views.create,            name="create"),
    path("<int:pk>/edit/",            views.edit,              name="edit"),
    path("<int:pk>/start/",           views.start_session,     name="start"),
    path("<int:pk>/q/new/",           views.question_create,   name="question_create"),
    path("<int:pk>/q/<int:qpk>/",     views.question_edit,     name="question_edit"),
    path("<int:pk>/q/<int:qpk>/delete/", views.question_delete, name="question_delete"),
    path("<int:pk>/q/reorder/",       views.question_reorder,  name="question_reorder"),
]