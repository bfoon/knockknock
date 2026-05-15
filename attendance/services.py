"""
Side-effect layer for the attendance app.

Everything that touches the outside world (SMTP, QR rendering, channel
layer, file system) lives here so views stay thin and the same code is
reachable from a Celery task or a management command.

Style follows services.py from the collaborations app:
  - All email sends go through _safe_send — failures are logged, not raised.
  - The DB row is the source of truth; delivery is best-effort.
"""

import io
import logging

import qrcode
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.core.mail import EmailMessage
from django.template.loader import render_to_string
from django.urls import reverse
from django.utils import timezone

from .models import Registration, EventAnnouncement, Certificate

logger = logging.getLogger(__name__)


# ───────────────────── helpers ─────────────────────

def _absolute(request, path):
    if request is None:
        return path
    return request.build_absolute_uri(path)


def _safe_send(subject, body, recipient, *, html_body=None, context_label="email"):
    """Send mail with logged-not-raised failures. Mirrors collaborations.services."""
    if not recipient:
        return False
    try:
        msg = EmailMessage(subject=subject, body=body,
                           from_email=None, to=[recipient])
        if html_body:
            msg.content_subtype = "html"
            msg.body = html_body
        msg.send(fail_silently=False)
        return True
    except Exception:
        logger.exception(
            "Failed to send %s to %s. The registration row is still valid; "
            "the organizer can re-send from the dashboard.",
            context_label, recipient,
        )
        return False


# ───────────────────── QR generation ─────────────────────

def make_qr_png(target_url, *, box_size=10, border=2):
    """Render a PNG of the given URL. Returns raw bytes."""
    img = qrcode.make(target_url, box_size=box_size, border=border)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# ───────────────────── Email sends ─────────────────────

def send_registration_confirmation(registration, request=None):
    """
    Confirmation email after a successful registration.
    Includes the per-attendee ticket URL — that page shows their personal QR
    plus the agenda. Doesn't gate on accepted status; PENDING still gets the
    email but with a 'pending review' note inside the template.
    """
    event = registration.event
    ticket_url = _absolute(request, registration.get_ticket_url())
    context = {
        "registration": registration,
        "event": event,
        "ticket_url": ticket_url,
        "is_accepted": registration.status == Registration.STATUS_ACCEPTED,
        "is_pending": registration.status == Registration.STATUS_PENDING,
    }
    body = render_to_string("emails/attendance_registration.txt", context)
    html = render_to_string("emails/attendance_registration.html", context)
    subject = f"You're registered for {event.title}"
    if registration.status == Registration.STATUS_PENDING:
        subject = f"Registration received — {event.title}"
    return _safe_send(
        subject, body, registration.email,
        html_body=html, context_label="registration confirmation",
    )


def send_acceptance_email(registration, request=None):
    """When organizer flips PENDING → ACCEPTED in manual mode."""
    event = registration.event
    context = {
        "registration": registration, "event": event,
        "ticket_url": _absolute(request, registration.get_ticket_url()),
    }
    body = render_to_string("emails/attendance_accepted.txt", context)
    return _safe_send(
        f"You're confirmed for {event.title}", body, registration.email,
        context_label="acceptance email",
    )


def send_decline_email(registration, request=None):
    """When organizer declines a registration."""
    event = registration.event
    context = {"registration": registration, "event": event}
    body = render_to_string("emails/attendance_declined.txt", context)
    return _safe_send(
        f"About your registration for {event.title}", body, registration.email,
        context_label="decline email",
    )


# ───────────────────── Announcements (fan-out) ─────────────────────

def send_announcement(event, *, subject, body, channel, audience, sender):
    """
    Persist an EventAnnouncement and deliver via the requested channels.

    audience is one of: 'all' / 'accepted' / 'checked_in' / 'pending'.
    """
    target_statuses = {
        "all":        [Registration.STATUS_ACCEPTED, Registration.STATUS_CHECKED_IN],
        "accepted":   [Registration.STATUS_ACCEPTED],
        "checked_in": [Registration.STATUS_CHECKED_IN],
        "pending":    [Registration.STATUS_PENDING],
    }.get(audience, [Registration.STATUS_ACCEPTED, Registration.STATUS_CHECKED_IN])

    qs = event.registrations.filter(status__in=target_statuses)
    delivered = 0

    announcement = EventAnnouncement.objects.create(
        event=event, sender=sender, subject=subject, body=body,
        channel=channel, target_statuses=",".join(target_statuses),
    )

    # Email leg
    if channel in ("email", "both"):
        for reg in qs.only("email", "full_name"):
            if not reg.email:
                continue
            email_body = (
                f"Hi {reg.full_name or 'there'},\n\n{body}\n\n— {event.title}"
            )
            if _safe_send(
                subject or f"Update — {event.title}", email_body, reg.email,
                context_label="event announcement",
            ):
                delivered += 1

    # In-app push leg — see consumers.AttendanceConsumer
    if channel in ("push", "both"):
        broadcast_to_event(event, {
            "type": "announcement",
            "subject": subject,
            "body": body,
            "sent_at": announcement.sent_at.isoformat(),
        })

    announcement.delivered_count = delivered
    announcement.save(update_fields=["delivered_count"])
    return announcement


# ───────────────────── WebSocket broadcasts ─────────────────────

def _event_group_name(event):
    return f"attendance_event_{event.pk}"


def broadcast_to_event(event, payload):
    """
    Push a JSON message to everyone subscribed to this event's group.
    No-op if Channels isn't configured.

    Mirrors `_broadcast_ended_to_sessions` in presentations/views.py.
    """
    layer = get_channel_layer()
    if not layer:
        return
    async_to_sync(layer.group_send)(
        _event_group_name(event),
        {"type": "broadcast", "payload": payload},
    )


def broadcast_check_in(registration):
    """Fire-and-forget — used right after a check-in flips."""
    broadcast_to_event(registration.event, {
        "type": "check_in",
        "registration_id": registration.pk,
        "name": registration.display_name(),
        "checked_in_at": registration.checked_in_at.isoformat()
            if registration.checked_in_at else timezone.now().isoformat(),
        "checked_in_count": registration.event.checked_in_count(),
        "accepted_count": registration.event.accepted_count(),
    })


def broadcast_new_registration(registration):
    broadcast_to_event(registration.event, {
        "type": "new_registration",
        "registration_id": registration.pk,
        "name": registration.display_name(),
        "status": registration.status,
        "accepted_count": registration.event.accepted_count(),
        "pending_count": registration.event.pending_count(),
    })


# ───────────────────── Certificates ─────────────────────

def generate_certificate(registration):
    """
    Create (or return existing) Certificate for a checked-in attendee.

    The PDF rendering is intentionally pluggable: if reportlab is available
    we draw a simple bordered cert; otherwise we just record the serial
    so the row exists and the organizer can render later. This keeps the
    install dependency-light by default.
    """
    if registration.status != Registration.STATUS_CHECKED_IN:
        raise ValueError("Only checked-in attendees can receive a certificate.")

    cert, created = Certificate.objects.get_or_create(registration=registration)
    if not created and cert.pdf_file:
        return cert

    try:
        from io import BytesIO
        from reportlab.lib.pagesizes import landscape, A4
        from reportlab.pdfgen import canvas
        from django.core.files.base import ContentFile
    except ImportError:
        logger.info("reportlab not installed — skipping PDF render, serial only.")
        return cert

    buf = BytesIO()
    w, h = landscape(A4)
    c = canvas.Canvas(buf, pagesize=landscape(A4))

    # Outer border
    c.setStrokeColorRGB(0.49, 0.23, 0.93)  # kk accent purple
    c.setLineWidth(3)
    c.rect(30, 30, w - 60, h - 60)

    c.setFont("Helvetica", 18)
    c.drawCentredString(w / 2, h - 110, "Certificate of Participation")

    c.setFont("Helvetica-Bold", 36)
    c.drawCentredString(w / 2, h - 200, registration.display_name())

    c.setFont("Helvetica", 14)
    c.drawCentredString(w / 2, h - 250,
                        f"attended {registration.event.title}")
    c.drawCentredString(w / 2, h - 280,
                        f"on {registration.event.starts_at:%d %B %Y}")

    c.setFont("Helvetica-Oblique", 10)
    c.drawString(60, 60, f"Serial: {cert.serial}")
    c.drawRightString(w - 60, 60, "Issued via Knock-Knock")

    c.showPage()
    c.save()
    buf.seek(0)

    cert.pdf_file.save(
        f"cert-{cert.serial}.pdf",
        ContentFile(buf.read()),
        save=True,
    )
    return cert
