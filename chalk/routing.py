from django.urls import re_path

from . import consumers

# 6-10 digits: new codes are 8, but sessions created before the change are
# still 6 and must keep pairing.
websocket_urlpatterns = [
    re_path(r"^ws/chalk/(?P<code>\d{6,10})/$", consumers.ChalkConsumer.as_asgi()),
]
