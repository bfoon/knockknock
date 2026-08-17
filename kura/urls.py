"""
kura/urls.py — routing for the Kura survey studio.

Mount PREFIXED in the project root urls.py, same as Hanns:

    path("kura/", include("kura.urls", namespace="kura")),

Resulting URLs:
    /kura/                          → list      (your surveys)
    /kura/new/                      → create    (POST)
    /kura/api/…                     → mobile sync API (token auth)
    /kura/<code>/build/             → builder   (the studio)
    /kura/<code>/build/save/        → autosave  (POST JSON)
    /kura/<code>/publish/           → publish   (POST → new FormVersion)
    /kura/<code>/state/             → set_state (POST)
    /kura/<code>/data/              → data workbench (clean/export)
    /kura/<code>/data/*             → workbench JSON endpoints
    /kura/<code>/qr.png             → share QR PNG (?variant=web|app, ?download=1)
    /kura/<code>/present-export/    → build a Hanns results deck (POST)
    /kura/<code>/submit/            → web runner submit (POST, public)

    Team collection (kura/team_views.py):
    /kura/<code>/teams/             → owner's team management screen
    /kura/<code>/join/<token>/      → invite link (supervisor / member / collaborator)
    /kura/<code>/team/<id>/board/   → the supervisor's board
    /kura/<code>/my/                → an enumerator's own submissions & fixes
    /kura/<code>/issues/…           → raise, assign, resolve data problems
    /kura/<code>/validation/…       → the owner's locked check suite
    /kura/<code>/chat/…             → chat REST fallback (WebSocket in routing.py)

    /kura/<code>/                   → collect   (public runner — the QR URL)

ORDERING MATTERS — same rule as hanns/urls.py: every literal route and
every longer-suffixed route must precede the bare <str:code>/ catch-all.
"""

from django.urls import path

from . import api, team_views, views, studio_views

app_name = "kura"

urlpatterns = [
    # ── Literal routes first ─────────────────────────────────────────
    path("", views.survey_list, name="list"),
    path("new/", views.survey_create, name="create"),

    # Mobile sync API (token auth — see kura/api.py docstring)
    path("api/devices/register/", api.device_register, name="api_device_register"),
    path("api/forms/access/", api.form_access, name="api_form_access"),
    path("api/forms/", api.forms_manifest, name="api_forms"),
    path("api/forms/<str:code>/", api.form_detail, name="api_form_detail"),
    path("api/forms/<str:code>/sync/", api.form_sync, name="api_form_sync"),
    path("api/forms/<str:code>/lookups/", api.form_lookups, name="api_form_lookups"),

    # ── Coded routes with literal suffixes ───────────────────────────
    path("<str:code>/build/", views.builder, name="builder"),
    path("<str:code>/build/save/", views.builder_save, name="builder_save"),
    path("<str:code>/publish/", views.publish, name="publish"),
    path("<str:code>/state/", views.set_state, name="set_state"),
    path("<str:code>/delete/", views.survey_delete, name="delete"),

    path("<str:code>/data/", views.data, name="data"),
    path("<str:code>/studio/", studio_views.studio, name="studio"),
    path("<str:code>/studio/bootstrap/", studio_views.studio_bootstrap, name="studio_bootstrap"),
    path("<str:code>/studio/pipelines/", studio_views.pipeline_list, name="pipeline_list"),
    path("<str:code>/studio/pipeline/save/", studio_views.pipeline_save, name="pipeline_save"),
    path("<str:code>/studio/pipeline/<int:pipeline_id>/run/", studio_views.pipeline_run, name="pipeline_run"),
    path("<str:code>/studio/pipeline/<int:pipeline_id>/duplicate/", studio_views.pipeline_duplicate, name="pipeline_duplicate"),
    path("<str:code>/studio/pipeline/<int:pipeline_id>/delete/", studio_views.pipeline_delete, name="pipeline_delete"),
    path("<str:code>/studio/datasets/upload/", studio_views.dataset_upload, name="dataset_upload"),
    path("<str:code>/studio/dataset/<int:dataset_id>/", studio_views.dataset_detail, name="dataset_detail"),
    path("<str:code>/studio/dataset/<int:dataset_id>/delete/", studio_views.dataset_delete, name="dataset_delete"),
    path("<str:code>/studio/run/<int:run_id>/rows/", studio_views.run_rows, name="run_rows"),
    path("<str:code>/studio/run/<int:run_id>/board/", studio_views.run_board, name="run_board"),
    path("<str:code>/studio/run/<int:run_id>/dashboard/", studio_views.run_dashboard, name="run_dashboard"),
    path("<str:code>/studio/run/<int:run_id>/summary/", studio_views.run_summary, name="run_summary"),
    path("<str:code>/studio/run/<int:run_id>/chart/", studio_views.run_chart, name="run_chart"),
    path("<str:code>/studio/run/<int:run_id>/timeseries/", studio_views.run_timeseries, name="run_timeseries"),
    path("<str:code>/studio/run/<int:run_id>/timeline/", studio_views.run_timeline, name="run_timeline"),
    path("<str:code>/studio/run/<int:run_id>/export/<str:fmt>/", studio_views.run_export, name="run_export"),
    path("<str:code>/monitor/", views.monitor, name="monitor"),
    path("<str:code>/monitor/device-access/", views.device_access_update, name="device_access_update"),
    path("<str:code>/monitor/feed/", views.monitor_feed, name="monitor_feed"),
    path("<str:code>/qr.png", views.qr_code, name="qr"),
    path("<str:code>/map/", views.live_map, name="live_map"),
    path("<str:code>/data/rows/", views.data_rows, name="data_rows"),
    path("<str:code>/data/edit/", views.edit_answer, name="edit_answer"),
    path("<str:code>/data/status/", views.set_row_status, name="row_status"),
    path("<str:code>/data/rules/", views.rules_save, name="rules_save"),
    path("<str:code>/data/clean/", views.run_cleaning, name="run_cleaning"),
    path("<str:code>/data/purge/", views.data_purge, name="data_purge"),
    path("<str:code>/data/export.csv", views.export_csv, name="export_csv"),
    path("<str:code>/present-export/", views.export_hanns, name="export_hanns"),

    # ── Team collection: management (owner) ──────────────────────────
    path("<str:code>/teams/", team_views.teams_page, name="teams"),
    path("<str:code>/teams/data/", team_views.teams_bootstrap, name="teams_bootstrap"),
    path("<str:code>/teams/config/", team_views.config_save, name="team_config"),
    path("<str:code>/teams/create/", team_views.team_create, name="team_create"),
    path("<str:code>/team/<int:team_id>/update/", team_views.team_update, name="team_update"),
    path("<str:code>/team/<int:team_id>/delete/", team_views.team_delete, name="team_delete"),
    path("<str:code>/team/<int:team_id>/members/add/", team_views.member_add, name="member_add"),
    path("<str:code>/team/<int:team_id>/members/<int:member_id>/remove/", team_views.member_remove, name="member_remove"),

    path("<str:code>/collaborators/add/", team_views.collaborator_add, name="collaborator_add"),
    path("<str:code>/collaborators/<int:collab_id>/remove/", team_views.collaborator_remove, name="collaborator_remove"),
    path("<str:code>/invites/create/", team_views.invite_create, name="invite_create"),
    path("<str:code>/invites/<int:invite_id>/revoke/", team_views.invite_revoke, name="invite_revoke"),
    path("<str:code>/join/<str:token>/", team_views.join, name="join"),

    # ── Team collection: the supervisor's board ──────────────────────
    path("<str:code>/team/<int:team_id>/board/", team_views.team_board, name="team_board"),
    path("<str:code>/team/<int:team_id>/board/data/", team_views.board_data, name="board_data"),
    path("<str:code>/team/<int:team_id>/board/rows/", team_views.board_rows, name="board_rows"),
    path("<str:code>/team/<int:team_id>/board/export.csv", team_views.board_export, name="board_export"),

    # ── Team collection: validation, issues, sign-off ────────────────
    path("<str:code>/validation/checks/", team_views.validation_checks_save, name="validation_checks"),
    path("<str:code>/validation/run/", team_views.validation_run, name="validation_run"),
    path("<str:code>/validation/history/", team_views.validation_history, name="validation_history"),

    path("<str:code>/issues/", team_views.issues_list, name="issues"),
    path("<str:code>/issues/create/", team_views.issue_create, name="issue_create"),
    path("<str:code>/issues/<int:issue_id>/update/", team_views.issue_update, name="issue_update"),

    path("<str:code>/team/<int:team_id>/signoff/", team_views.signoff_state, name="signoff_state"),
    path("<str:code>/team/<int:team_id>/signoff/sign/", team_views.signoff_sign, name="signoff_sign"),
    path("<str:code>/signoff/<int:signoff_id>/return/", team_views.signoff_return, name="signoff_return"),

    # ── Team collection: enumerator self-service ─────────────────────
    path("<str:code>/my/", team_views.my_work, name="my_work"),
    path("<str:code>/my/tasks/", team_views.my_tasks, name="my_tasks"),

    # ── Team collection: chat REST fallback ──────────────────────────
    path("<str:code>/chat/threads/", team_views.chat_threads, name="chat_threads"),
    path("<str:code>/chat/messages/", team_views.chat_messages, name="chat_messages"),
    path("<str:code>/chat/send/", team_views.chat_send, name="chat_send"),
    path("<str:code>/chat/read/", team_views.chat_read, name="chat_read"),
    path("<str:code>/chat/direct/", team_views.chat_direct, name="chat_direct"),

    path("<str:code>/submit/", views.collect_submit, name="collect_submit"),
    path("<str:code>/preview/", views.preview, name="preview"),
    path("<str:code>/preview/schema/", views.preview_schema, name="preview_schema"),
    path("<str:code>/lookups/upload/", views.lookups_upload, name="lookups_upload"),
    path("<str:code>/lookups/<int:pk>/delete/", views.lookup_delete, name="lookup_delete"),
    path("<str:code>/lookup/", views.lookup_query, name="lookup_query"),

    # ── Catch-all last: the public runner (URL encoded in the QR) ────
    path("<str:code>/", views.collect, name="collect"),
]
