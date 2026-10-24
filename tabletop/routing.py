from django.urls import re_path

from . import consumers

websocket_urlpatterns = [
    re_path(r"^ws/tabletop/(?P<code>\d{6})/$", consumers.TabletopConsumer.as_asgi()),
]
