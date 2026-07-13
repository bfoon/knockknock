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
    /kura/<code>/                   → collect   (public runner — the QR URL)

ORDERING MATTERS — same rule as hanns/urls.py: every literal route and
every longer-suffixed route must precede the bare <str:code>/ catch-all.
"""

from django.urls import path

from . import api, views, studio_views

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
    path("<str:code>/studio/run/<int:run_id>/rows/", studio_views.run_rows, name="run_rows"),
    path("<str:code>/studio/run/<int:run_id>/dashboard/", studio_views.run_dashboard, name="run_dashboard"),
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

    path("<str:code>/submit/", views.collect_submit, name="collect_submit"),
    path("<str:code>/preview/", views.preview, name="preview"),
    path("<str:code>/preview/schema/", views.preview_schema, name="preview_schema"),
    path("<str:code>/lookups/upload/", views.lookups_upload, name="lookups_upload"),
    path("<str:code>/lookups/<int:pk>/delete/", views.lookup_delete, name="lookup_delete"),
    path("<str:code>/lookup/", views.lookup_query, name="lookup_query"),

    # ── Catch-all last: the public runner (URL encoded in the QR) ────
    path("<str:code>/", views.collect, name="collect"),
]