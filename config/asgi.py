"""
ASGI config — routes HTTP to Django + WebSockets to Channels.
"""
import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django_asgi_app = get_asgi_application()

from channels.auth import AuthMiddlewareStack
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.security.websocket import AllowedHostsOriginValidator

import presentations.routing
import boardly.routing
import hanns.routing
import quest_rpg.routing
import chalk.routing


websocket_urlpatterns = (
    presentations.routing.websocket_urlpatterns
    + boardly.routing.websocket_urlpatterns
    + hanns.routing.websocket_urlpatterns
    + quest_rpg.routing.websocket_urlpatterns
    + chalk.routing.websocket_urlpatterns
)


application = ProtocolTypeRouter({
    "http": django_asgi_app,
    "websocket": AllowedHostsOriginValidator(
        AuthMiddlewareStack(
            URLRouter(websocket_urlpatterns)
        )
    ),
})
