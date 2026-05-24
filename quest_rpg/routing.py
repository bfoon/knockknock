from django.urls import re_path

from .consumers import QuestConsumer

websocket_urlpatterns = [
    re_path(r"ws/quest/(?P<code>\w+)/$", QuestConsumer.as_asgi()),
]
