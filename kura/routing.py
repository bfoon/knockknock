"""
kura/routing.py — WebSocket route for the Kura live monitor.

Include it in the project ASGI URLRouter alongside Boardly's and Hanns':

    import boardly.routing, hanns.routing, kura.routing
    websocket_urlpatterns = (
        boardly.routing.websocket_urlpatterns
        + hanns.routing.websocket_urlpatterns
        + kura.routing.websocket_urlpatterns
    )

IMPORTANT — same rule as hanns/routing.py: the pattern has NO leading
slash, or Channels silently misses the route.
"""

from django.urls import re_path

from .consumers import MonitorConsumer

websocket_urlpatterns = [
    re_path(r"ws/kura/(?P<code>\w+)/monitor/$", MonitorConsumer.as_asgi()),
]
