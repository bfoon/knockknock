"""
boardly/routing.py — WebSocket route(s) for the Boardly board.

Import this from your project's asgi.py and include it in the websocket
URLRouter. The pattern below matches what boardly_play.js and
boardly_stage.js connect to:

    ws://<host>/ws/board/<CODE>/

IMPORTANT — the path Channels matches has NO leading slash. Write the
pattern as r"ws/board/..."  (a leading "/ws/board/..." will silently miss
and you'll get: ValueError: No route found for path 'ws/board/XXXX/').
"""

from django.urls import re_path

from .consumers import BoardConsumer

websocket_urlpatterns = [
    re_path(r"ws/board/(?P<code>\w+)/$", BoardConsumer.as_asgi()),
]
