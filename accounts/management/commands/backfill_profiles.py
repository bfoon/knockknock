"""
Backfill Profile rows for users created before the post_save signal existed.

Usage:
    python manage.py backfill_profiles
"""

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from accounts.models import Profile

User = get_user_model()


class Command(BaseCommand):
    help = "Create a Profile for any User that doesn't already have one."

    def handle(self, *args, **options):
        users_without_profile = User.objects.filter(profile__isnull=True)
        count = users_without_profile.count()
        if count == 0:
            self.stdout.write(self.style.SUCCESS("All users already have profiles. Nothing to do."))
            return

        for user in users_without_profile:
            Profile.objects.create(user=user, display_name=user.username)
            self.stdout.write(f"  ✓ Profile created for {user.username}")

        self.stdout.write(self.style.SUCCESS(f"Backfilled {count} profile(s)."))
