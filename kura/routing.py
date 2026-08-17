"""
kura/routing.py — WebSocket routes for Kura.

    ws/kura/<code>/monitor/            live monitor (owner)
    ws/kura/<code>/chat/<thread_id>/   survey / team / direct chat

Include it in the project ASGI URLRouter alongside Boardly's and Hanns':

    import boardly.routing, hanns.routing, kura.routing
    websocket_urlpatterns = (
        boardly.routing.websocket_urlpatterns
        + hanns.routing.websocket_urlpatterns
        + kura.routing.websocket_urlpatterns
    )

IMPORTANT — same rule as hanns/routing.py: the patterns have NO leading
slash, or Channels silently misses the route. The chat pattern is listed
first because it is the more specific of the two.
"""

from django.urls import re_path

from .chat_consumers import ChatConsumer
from .consumers import MonitorConsumer

websocket_urlpatterns = [
    re_path(
        r"ws/kura/(?P<code>\w+)/chat/(?P<thread_id>\d+)/$",
        ChatConsumer.as_asgi(),
    ),
    re_path(r"ws/kura/(?P<code>\w+)/monitor/$", MonitorConsumer.as_asgi()),
]
