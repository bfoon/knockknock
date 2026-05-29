"""
boardly/urls.py — URL routing for the Boardly board.

This file is written for a PREFIXED mount in the project root urls.py:

    path("board/", include("boardly.urls", namespace="boardly")),

Because the "board/" prefix is supplied by the root urls.py, the routes
below must NOT repeat it — otherwise URLs become "/board/board/new/".

Resulting URLs:
    /board/                     → list   (the owner's saved boards)
    /board/new/                 → create
    /board/<code>/present/      → stage  (presenter / projector)
    /board/<code>/columns/reorder/ → reorder columns (POST only)
    /board/<code>/background/   → update board background (POST only)
    /board/<code>/delete/       → delete (POST only)
    /board/<code>/              → play   (participant; encoded in the QR)

ORDERING MATTERS. ``<str:code>`` matches any string — including the
literal word "new". Every literal route, and every route with a longer
literal suffix (``/present/``, ``/delete/``), MUST be listed before the
bare ``<str:code>/`` catch-all, or Django stops at the catch-all first
and e.g. "/board/new/" gets handled by ``board_play`` (which then 404s
looking for a board whose code is "new").
"""

from django.urls import path

from . import views

app_name = "boardly"

urlpatterns = [
    # ── Literal / specific routes first ──────────────────────────────
    # The owner's saved boards. Empty path → /board/.
    path("", views.board_list, name="list"),

    # Create a new board. Must precede "<str:code>/" or "new" would be
    # captured as a board code.
    path("new/", views.board_create, name="create"),

    # Presenter / projector screen — extra "present/" segment.
    path("<str:code>/present/", views.board_stage, name="stage"),

    # Persist presenter column ordering and board background updates.
    path("<str:code>/columns/reorder/", views.board_columns_reorder, name="columns_reorder"),
    path("<str:code>/background/", views.board_background, name="background"),

    # Delete a board (POST only) — extra "delete/" segment.
    path("<str:code>/delete/", views.board_delete, name="delete"),

    # ── Catch-all last ───────────────────────────────────────────────
    # Participant view — this is the URL encoded in the QR code.
    path("<str:code>/", views.board_play, name="play"),
]