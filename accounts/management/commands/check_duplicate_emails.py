"""
Run this BEFORE applying 0002_unique_user_email.

    python manage.py check_duplicate_emails
    python manage.py check_duplicate_emails --normalize
    python manage.py check_duplicate_emails --normalize --blank-duplicates

--normalize          lowercases/strips every stored email
--blank-duplicates   for each duplicated address, keeps the oldest account
                     (lowest pk) and blanks the email on the rest, so the
                     unique index can be created. Nothing is deleted.
"""
from collections import defaultdict

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

User = get_user_model()


class Command(BaseCommand):
    help = "Report (and optionally fix) accounts sharing an email address."

    def add_arguments(self, parser):
        parser.add_argument(
            "--normalize",
            action="store_true",
            help="Lowercase and strip all stored email addresses.",
        )
        parser.add_argument(
            "--blank-duplicates",
            action="store_true",
            help="Keep the oldest account per address; blank the email on the others.",
        )

    def handle(self, *args, **options):
        if options["normalize"]:
            changed = 0
            for pk, email in User.objects.exclude(email="").values_list("pk", "email"):
                cleaned = (email or "").strip().lower()
                if cleaned != email:
                    User.objects.filter(pk=pk).update(email=cleaned)
                    changed += 1
            self.stdout.write(self.style.SUCCESS(f"Normalized {changed} email(s)."))

        groups = defaultdict(list)
        for pk, username, email in (
            User.objects.exclude(email="")
            .order_by("pk")
            .values_list("pk", "username", "email")
        ):
            groups[email.strip().lower()].append((pk, username))

        dupes = {e: rows for e, rows in groups.items() if len(rows) > 1}

        if not dupes:
            self.stdout.write(self.style.SUCCESS(
                "No duplicate emails. Safe to run the migration."
            ))
            return

        self.stdout.write(self.style.WARNING(
            f"{len(dupes)} email address(es) used by more than one account:"
        ))
        for email, rows in sorted(dupes.items()):
            listed = ", ".join(f"#{pk} {username}" for pk, username in rows)
            self.stdout.write(f"  {email}  ->  {listed}")

        if not options["blank_duplicates"]:
            self.stdout.write(
                "\nRe-run with --blank-duplicates to keep the oldest account "
                "for each address and blank the email on the rest."
            )
            return

        blanked = 0
        for email, rows in dupes.items():
            for pk, username in rows[1:]:  # rows are pk-ordered; keep the first
                User.objects.filter(pk=pk).update(email="")
                blanked += 1
                self.stdout.write(f"  blanked email on #{pk} {username}")

        self.stdout.write(self.style.SUCCESS(
            f"Blanked {blanked} duplicate email(s). The migration can now run."
        ))
