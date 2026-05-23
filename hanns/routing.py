"""
hanns/routing.py — WebSocket route(s) for live Hanns presentations.

Import this from your project's asgi.py and include it in the websocket
URLRouter, alongside Boardly's. The pattern matches what hanns_present.js
connects to:

    ws://<host>/ws/hanns/<CODE>/

IMPORTANT — the path Channels matches has NO leading slash. Write the
pattern as r"ws/hanns/..."  (a leading "/ws/hanns/..." silently misses and
raises: ValueError: No route found for path 'ws/hanns/XXXX/').

Example project asgi.py wiring:

    import boardly.routing
    import hanns.routing
    websocket_urlpatterns = (
        boardly.routing.websocket_urlpatterns
        + hanns.routing.websocket_urlpatterns
    )
"""

from django.urls import re_path

from .consumers import PresentConsumer

websocket_urlpatterns = [
    re_path(r"ws/hanns/(?P<code>\w+)/$", PresentConsumer.as_asgi()),
]
