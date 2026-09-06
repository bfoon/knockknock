from django.apps import AppConfig


class PublishConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "publish"
    verbose_name = "Publications"

    def ready(self):
        # Registers the source adapters. Import is lazy inside the module, so
        # this does not pull in hanns/kura/chalk at import time.
        from . import sources  # noqa: F401
