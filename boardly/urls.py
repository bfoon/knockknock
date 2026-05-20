"""
boardly/urls.py — URL routing for the Boardly board.

This file is written for a PREFIXED mount in the project root urls.py:

    path("board/", include("boardly.urls", namespace="boardly")),

Because the "board/" prefix is supplied by the root urls.py, the routes
below must NOT repeat it — otherwise URLs become "/board/board/new/".

Resulting URLs:
    /board/new/                 → create
    /board/<code>/present/      → stage  (presenter / projector)
    /board/<code>/              → play   (participant; encoded in the QR)

ORDERING MATTERS. ``<str:code>`` matches any string — including the
literal word "new". Every literal route MUST be listed before the
``<str:code>`` catch-all, or Django stops at the catch-all first and
"/board/new/" gets handled by ``board_play`` (which then 404s looking
for a board whose code is "new").
"""

from django.urls import path

from . import views

app_name = "boardly"

urlpatterns = [
    # ── Literal / specific routes first ──────────────────────────────
    # Create a new board. Must precede "<str:code>/" or "new" would be
    # captured as a board code.
    path("new/", views.board_create, name="create"),

    # Presenter / projector screen. More specific than the participant
    # route (extra "present/" segment), so it also goes above.
    path("<str:code>/present/", views.board_stage, name="stage"),

    # ── Catch-all last ───────────────────────────────────────────────
    # Participant view — this is the URL encoded in the QR code.
    path("<str:code>/", views.board_play, name="play"),
]