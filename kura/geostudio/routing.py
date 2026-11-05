from django.urls import re_path

from .consumers import GeoStudioConsumer

# No leading slash (Channels rule, same as kura/routing.py).
websocket_urlpatterns = [
    re_path(r"ws/kura/geo/(?P<pid>[0-9a-f-]{36})/$", GeoStudioConsumer.as_asgi()),
]
