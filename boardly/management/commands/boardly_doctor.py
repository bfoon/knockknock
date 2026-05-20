"""
boardly/management/commands/boardly_doctor.py

Run this in EACH way you start the app, and compare the output:

    # however you serve HTTP pages (creation, page loads):
    python manage.py boardly_doctor

    # If you run Channels separately (daphne / uvicorn / runserver in ASGI),
    # the WebSocket process must see the SAME database. There is no clean way
    # to run a management command "inside" daphne, so instead this command
    # writes a marker row and prints the absolute DB path + a live count.
    # Run it once, then create a board in the browser, then run it again:
    # the count MUST go up. If the browser-created board never appears here,
    # your web process and this process are on different databases.

What to look for
----------------
1. DB ENGINE / NAME — if NAME is ":memory:" you have found the bug. Every
   process (and often every connection) gets its own throwaway database, so
   nothing ever persists and a refresh "loses" everything. Use a file path.
2. ABSOLUTE DB PATH — must be byte-for-byte identical between your HTTP server
   and your WebSocket server. A relative "db.sqlite3" started from two
   different working directories = two different files.
3. PENDING MIGRATIONS — if boardly has unapplied migrations, the table may be
   missing or stale. Run makemigrations boardly && migrate.
"""

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


class Command(BaseCommand):
    help = "Diagnose Boardly database / persistence problems."

    def handle(self, *args, **opts):
        db = settings.DATABASES["default"]
        engine = db.get("ENGINE", "?")
        name = str(db.get("NAME", "?"))

        self.stdout.write(self.style.MIGRATE_HEADING("── Boardly doctor ──"))
        self.stdout.write(f"DB ENGINE : {engine}")
        self.stdout.write(f"DB NAME   : {name}")

        # Resolve the absolute path for sqlite so two processes can be compared.
        if "sqlite" in engine:
            import os
            if name == ":memory:":
                self.stdout.write(self.style.ERROR(
                    "  ✗ NAME is ':memory:' — this is almost certainly your bug. "
                    "An in-memory SQLite database is per-process and is wiped on "
                    "restart. Point NAME at a real file, e.g. BASE_DIR/'db.sqlite3'."
                ))
            else:
                self.stdout.write(f"DB ABSPATH: {os.path.abspath(name)}")
                self.stdout.write(
                    "  → This absolute path MUST match between your HTTP server "
                    "and your WebSocket (Channels) server."
                )

        # Channel layer — InMemory won't share across processes either.
        layers = getattr(settings, "CHANNEL_LAYERS", {})
        backend = layers.get("default", {}).get("BACKEND", "(none configured)")
        self.stdout.write(f"CHANNEL   : {backend}")
        if "InMemory" in backend:
            self.stdout.write(self.style.WARNING(
                "  ! InMemoryChannelLayer only works inside ONE process. If your "
                "HTTP and WebSocket servers are separate, presenter↔participant "
                "messages won't cross. Use channels_redis for multi-process."
            ))

        # Pending migrations?
        try:
            executor = MigrationExecutor(connection)
            targets = executor.loader.graph.leaf_nodes()
            plan = executor.migration_plan(targets)
            if plan:
                self.stdout.write(self.style.ERROR(
                    f"  ✗ {len(plan)} unapplied migration(s). Run: "
                    "python manage.py makemigrations boardly && migrate"
                ))
            else:
                self.stdout.write(self.style.SUCCESS("  ✓ migrations up to date"))
        except Exception as exc:  # pragma: no cover
            self.stdout.write(self.style.WARNING(f"  ! migration check failed: {exc}"))

        # Live row counts — the real persistence proof.
        from boardly.models import BoardSession, Note
        self.stdout.write(self.style.MIGRATE_HEADING("── Live counts ──"))
        self.stdout.write(f"BoardSession rows: {BoardSession.objects.count()}")
        self.stdout.write(f"Note rows        : {Note.objects.count()}")
        recent = BoardSession.objects.order_by("-created_at")[:5]
        for b in recent:
            self.stdout.write(f"  • {b.code}  state={b.state!r}  '{b.title}'")
        if not recent:
            self.stdout.write("  (no boards yet)")
        self.stdout.write(
            "\nNow create a board in the browser, then run this again. If the "
            "count does NOT increase, your web process is writing to a different "
            "database than this command is reading."
        )
