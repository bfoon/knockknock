from django.apps import AppConfig


class GeoStudioConfig(AppConfig):
    """Kura Geo Studio — lives inside the Kura package but is its own Django
    app (label ``kura_geo``) with its own migrations folder, so it never has
    to share a migration history with kura/migrations."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "kura.geostudio"
    label = "kura_geo"
    verbose_name = "Kura Geo Studio"
