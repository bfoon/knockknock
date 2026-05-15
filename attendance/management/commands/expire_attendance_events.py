"""
Auto-expire events whose end_time has passed.

The QR/link views already check `is_qr_active()` at request time, so an
attendee can't slip through after the end. This command is a janitor:
it flips status to ENDED and broadcasts to any open ticket pages so they
see the "this event has ended" banner without polling.

Usage:
    python manage.py expire_attendance_events

Schedule via cron or Celery beat to run every few minutes.
"""

from django.core.management.base import BaseCommand
from django.utils import timezone

from attendance.models import AttendanceEvent
from attendance.services import broadcast_to_event


class Command(BaseCommand):
    help = "Mark events ENDED once their end_time has passed."

    def handle(self, *args, **options):
        now = timezone.now()
        qs = AttendanceEvent.objects.filter(
            ends_at__lte=now,
        ).exclude(status=AttendanceEvent.STATUS_ENDED)

        count = 0
        for event in qs:
            event.status = AttendanceEvent.STATUS_ENDED
            event.save(update_fields=["status"])
            broadcast_to_event(event, {
                "type": "event_ended",
                "message": "This event has ended.",
            })
            count += 1
            self.stdout.write(self.style.SUCCESS(f"Expired: {event.title} (#{event.pk})"))

        self.stdout.write(self.style.SUCCESS(f"Done. {count} event(s) marked ended."))
