from django.urls import re_path

from . import consumers

websocket_urlpatterns = [
    re_path(r"^ws/chalk/(?P<code>\d{6})/$", consumers.ChalkConsumer.as_asgi()),
]
