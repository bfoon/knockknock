"""
hanns/routing.py — WebSocket route(s) for live Hanns presentations.

Import this from your project's asgi.py and include it in the websocket
URLRouter, alongside Boardly's. The patterns match what the clients
connect to:

    ws://<host>/ws/hanns/<CODE>/            a deck (stage, phone, audience)
    ws://<host>/ws/hanns/screen/<TOKEN>/    a Big Screen and its host

IMPORTANT — the path Channels matches has NO leading slash. Write the
pattern as r"ws/hanns/...".

The screen route is listed first. The deck pattern would not match it
anyway (``\\w+`` stops at the extra slash), but keeping the more specific
route first means nobody has to reason about that.

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
from .screen_consumers import ScreenConsumer

websocket_urlpatterns = [
    re_path(r"ws/hanns/screen/(?P<token>[-\w]+)/$", ScreenConsumer.as_asgi()),
    re_path(r"ws/hanns/(?P<code>\w+)/$", PresentConsumer.as_asgi()),
]
