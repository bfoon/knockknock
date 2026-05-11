from django.apps import AppConfig


class OrganizationsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "organizations"

    def ready(self):
        from django.contrib.auth import get_user_model
        from .models import active_membership
        User = get_user_model()
        # Attach as a method so callers can do user.active_membership()
        if not hasattr(User, "active_membership"):
            User.add_to_class("active_membership", active_membership)
