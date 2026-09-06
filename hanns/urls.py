"""
hanns/urls.py — URL routing for the Hanns presentation studio.

Written for a PREFIXED mount in the project root urls.py:

    path("hanns/", include("hanns.urls", namespace="hanns")),

Because the "hanns/" prefix is supplied by the root urls.py, the routes
below must NOT repeat it.

Resulting URLs:
    /hanns/                     → list    (the owner's saved decks)
    /hanns/new/                 → create  (POST; makes a deck, opens editor)
    /hanns/review/<token>/      → review  (PUBLIC view-only deck)
    /hanns/<code>/edit/         → edit    (the studio editor)
    /hanns/<code>/save/         → save    (POST JSON; AJAX persist)
    /hanns/<code>/present/      → present (presenter / projector stage)
    /hanns/<code>/state/        → set_state (POST; live | ended)
    /hanns/<code>/delete/       → delete  (POST only)
    /hanns/<code>/              → join    (audience phone; encoded in the QR)

ORDERING MATTERS — same rule as boardly/urls.py. ``<str:code>`` matches any
string including "new", so every literal route and every route with a
longer literal suffix MUST precede the bare ``<str:code>/`` catch-all, or
"/hanns/new/" would be captured by deck_join looking for a deck coded
"new".

The review link is keyed on the token ALONE, with no deck code in it. That
is deliberate: the code is the key to the audience page and the presenter
controller, so a link you hand to an outside reviewer must not contain it.
"""

from django.urls import path

from . import views

app_name = "hanns"

urlpatterns = [
    # ── Literal / specific routes first ──────────────────────────────
    path("", views.deck_list, name="list"),
    path("new/", views.deck_create, name="create"),
    path("import-powerpoint/", views.deck_import_powerpoint_new, name="import_powerpoint_new"),

    # PUBLIC — view-only review link. Token only, no deck code.
    path("review/<uuid:token>/", views.deck_review, name="review"),
    path("review/<uuid:token>/ask/", views.deck_request_access, name="request_access"),

    path("<str:code>/edit/", views.deck_edit, name="edit"),
    path("<str:code>/save/", views.deck_save, name="save"),
    path("<str:code>/image-upload/", views.deck_image_upload, name="image_upload"),
    path("<str:code>/powerpoint-import/", views.deck_powerpoint_import, name="powerpoint_import"),
    path("<str:code>/powerpoint-export/", views.deck_export_powerpoint, name="powerpoint_export"),
    path("<str:code>/html-export/", views.deck_export_html, name="html_export"),
    path("<str:code>/download-settings/", views.deck_download_settings, name="download_settings"),
    path("<str:code>/review-settings/", views.deck_review_settings, name="review_settings"),
    path("<str:code>/access-requests/<int:pk>/decide/", views.deck_access_decide, name="access_decide"),
    # PUBLIC — the end-of-show QR points here. The uuid token is the
    # credential, so this route must stay above the <str:code>/ catch-all.
    path("<str:code>/d/<uuid:token>/", views.deck_audience_download, name="audience_download"),
    path("invite/<uuid:token>/accept/", views.deck_accept_invite, name="accept_invite"),
    path("<str:code>/present/", views.deck_present, name="present"),
    path("<str:code>/control/", views.deck_control, name="control"),
    path("<str:code>/invite/", views.deck_invite, name="invite"),
    path("<str:code>/state/", views.deck_set_state, name="set_state"),
    path("<str:code>/delete/", views.deck_delete, name="delete"),

    # ── Catch-all last ───────────────────────────────────────────────
    # Audience phone — this is the URL encoded in the QR code.
    path("<str:code>/", views.deck_join, name="join"),
]
