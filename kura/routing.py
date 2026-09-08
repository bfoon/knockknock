"""
kura/routing.py — WebSocket routes for Kura.

    ws/kura/<code>/monitor/            live monitor (owner)
    ws/kura/<code>/chat/<thread_id>/   survey / team / direct chat
    ws/kura/<code>/dashboard/          live dashboards (owner + collaborators)
    ws/kura/d/<token>/dashboard/       live dashboard on a public share link

Include it in the project ASGI URLRouter alongside Boardly's and Hanns':

    import boardly.routing, hanns.routing, kura.routing
    websocket_urlpatterns = (
        boardly.routing.websocket_urlpatterns
        + hanns.routing.websocket_urlpatterns
        + kura.routing.websocket_urlpatterns
    )

IMPORTANT — same rule as hanns/routing.py: the patterns have NO leading
slash, or Channels silently misses the route. More specific patterns come
first; note that the public dashboard route must precede the coded one,
because ``d`` would otherwise be swallowed by ``(?P<code>\\w+)``.
"""

from django.urls import re_path

from .chat_consumers import ChatConsumer
from .consumers import MonitorConsumer
from .dashboard_consumers import DashboardConsumer

websocket_urlpatterns = [
    re_path(
        r"ws/kura/(?P<code>\w+)/chat/(?P<thread_id>\d+)/$",
        ChatConsumer.as_asgi(),
    ),
    re_path(
        r"ws/kura/d/(?P<token>[-\w]+)/dashboard/$",
        DashboardConsumer.as_asgi(),
    ),
    re_path(
        r"ws/kura/(?P<code>\w+)/dashboard/$",
        DashboardConsumer.as_asgi(),
    ),
    re_path(r"ws/kura/(?P<code>\w+)/monitor/$", MonitorConsumer.as_asgi()),
]
