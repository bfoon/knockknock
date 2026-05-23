"""
hanns/urls.py — URL routing for the Hanns presentation studio.

Written for a PREFIXED mount in the project root urls.py:

    path("hanns/", include("hanns.urls", namespace="hanns")),

Because the "hanns/" prefix is supplied by the root urls.py, the routes
below must NOT repeat it.

Resulting URLs:
    /hanns/                     → list    (the owner's saved decks)
    /hanns/new/                 → create  (POST; makes a deck, opens editor)
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
"""

from django.urls import path

from . import views

app_name = "hanns"

urlpatterns = [
    # ── Literal / specific routes first ──────────────────────────────
    path("", views.deck_list, name="list"),
    path("new/", views.deck_create, name="create"),

    path("<str:code>/edit/", views.deck_edit, name="edit"),
    path("<str:code>/save/", views.deck_save, name="save"),
    path("<str:code>/present/", views.deck_present, name="present"),
    path("<str:code>/state/", views.deck_set_state, name="set_state"),
    path("<str:code>/delete/", views.deck_delete, name="delete"),

    # ── Catch-all last ───────────────────────────────────────────────
    # Audience phone — this is the URL encoded in the QR code.
    path("<str:code>/", views.deck_join, name="join"),
]
