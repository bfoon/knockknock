from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    re_path(r"ws/attendance/(?P<event_id>\d+)/$", consumers.AttendanceConsumer.as_asgi()),
]
