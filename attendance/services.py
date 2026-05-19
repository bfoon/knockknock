"""
Side-effect layer for the attendance app.

Everything that touches the outside world (SMTP, QR rendering, channel
layer, file system) lives here so views stay thin and the same code is
reachable from a Celery task or a management command.

Style follows services.py from the collaborations app:
  - All email sends go through _safe_send — failures are logged, not raised.
  - The DB row is the source of truth; delivery is best-effort.

Certificate rendering:
  Ten built-in design recipes live in this file as `draw_certificate_<key>`
  functions, each taking the same (canvas, page_w, page_h, registration,
  event) signature. The dispatcher `_render_certificate` picks one by
  CERTIFICATE_TEMPLATES key. After the design renders, we paste the
  optional logo PNG at the organizer-chosen position. Adding an 11th
  design is two changes: an entry in CERTIFICATE_TEMPLATES (models.py)
  and a matching `draw_certificate_<key>` function below.
"""

import io
import logging
from datetime import datetime
from io import BytesIO
from urllib.parse import urlencode

import qrcode
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.core.mail import EmailMessage
from django.template.loader import render_to_string
from django.urls import reverse
from django.utils import timezone

from .models import (
    Registration, EventAnnouncement, Certificate,
    DEFAULT_CERTIFICATE_TEMPLATE,
)

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


# ═══════════════════════════════════════════════════════════════════
# Certificate rendering
# ═══════════════════════════════════════════════════════════════════
#
# All ten designs share a 3-step structure:
#
#   1. Wash the background (solid colour or gradient).
#   2. Draw decorative chrome (border, ribbon, confetti, leaves, etc.).
#   3. Draw the four text blocks (title, recipient name, body, footer).
#
# After the function returns, the dispatcher draws the optional logo on
# top. Keeping the text layout consistent across designs means the
# organiser's choice only changes *vibe*, not *what's on the cert* —
# which matches what people expect when they pick "a different design".

def _try_import_reportlab():
    """Single import point. Returns (module_dict | None)."""
    try:
        from io import BytesIO
        from reportlab.lib.pagesizes import landscape, A4
        from reportlab.lib.colors import HexColor
        from reportlab.pdfgen import canvas
        from reportlab.lib.units import mm
        from reportlab.lib.utils import ImageReader
        from django.core.files.base import ContentFile
        return {
            "BytesIO": BytesIO, "landscape": landscape, "A4": A4,
            "HexColor": HexColor, "canvas": canvas, "mm": mm,
            "ImageReader": ImageReader, "ContentFile": ContentFile,
        }
    except ImportError:
        return None


def _text_block(c, *, page_w, page_h, name, event_title, event_date,
                serial, primary_hex, accent_hex,
                title_text="Certificate of Participation",
                body_lead="has successfully participated in",
                title_font="Helvetica", name_font="Helvetica-Bold"):
    """
    Shared text layout — every design calls this so wording is consistent.
    Coordinates are in points; reportlab's origin is bottom-left.
    """
    # Top title
    c.setFillColor(primary_hex)
    c.setFont(title_font, 22)
    c.drawCentredString(page_w / 2, page_h - 165, title_text)

    # "This is to certify that"
    c.setFillColor(primary_hex)
    c.setFont("Helvetica-Oblique", 12)
    c.drawCentredString(page_w / 2, page_h - 200, "This is to certify that")

    # Name — the big one
    c.setFillColor(accent_hex)
    c.setFont(name_font, 42)
    c.drawCentredString(page_w / 2, page_h - 260, name)

    # Underline under the name
    c.setStrokeColor(accent_hex)
    c.setLineWidth(0.8)
    name_underline_y = page_h - 272
    c.line(page_w * 0.25, name_underline_y, page_w * 0.75, name_underline_y)

    # Body
    c.setFillColor(primary_hex)
    c.setFont("Helvetica", 13)
    c.drawCentredString(page_w / 2, page_h - 305, body_lead)
    c.setFont("Helvetica-Bold", 16)
    c.drawCentredString(page_w / 2, page_h - 335, event_title)
    c.setFont("Helvetica", 12)
    c.drawCentredString(page_w / 2, page_h - 360, f"on {event_date}")

    # Footer: serial bottom-left, "Issued via Knock-Knock" bottom-right
    c.setFont("Helvetica-Oblique", 9)
    c.setFillColor(primary_hex)
    c.drawString(50, 40, f"Serial: {serial}")
    c.drawRightString(page_w - 50, 40, "Issued via Knock-Knock")


# ── DESIGN 1: Classic Laurel ─────────────────────────────────────
def draw_certificate_classic(c, page_w, page_h, registration, event, rl, cert):
    HexColor = rl["HexColor"]
    bg = HexColor("#f8f5ee")
    ink = HexColor("#1e293b")
    gold = HexColor("#c5a572")

    c.setFillColor(bg)
    c.rect(0, 0, page_w, page_h, fill=1, stroke=0)

    # Double gold border
    c.setStrokeColor(gold)
    c.setLineWidth(4)
    c.rect(28, 28, page_w - 56, page_h - 56)
    c.setLineWidth(1.5)
    c.rect(40, 40, page_w - 80, page_h - 80)

    # Simple laurel hint — gold dots in the corners
    for cx, cy in [(60, page_h - 60), (page_w - 60, page_h - 60),
                   (60, 60), (page_w - 60, 60)]:
        c.setFillColor(gold)
        c.circle(cx, cy, 4, fill=1, stroke=0)

    _text_block(
        c, page_w=page_w, page_h=page_h,
        name=registration.display_name(),
        event_title=event.title,
        event_date=event.starts_at.strftime("%d %B %Y"),
        serial=cert.serial,
        primary_hex=ink, accent_hex=gold,
        title_font="Times-Roman", name_font="Times-Bold",
        title_text="Certificate of Participation",
    )


# ── DESIGN 2: Modern Minimalist ──────────────────────────────────
def draw_certificate_modern(c, page_w, page_h, registration, event, rl, cert):
    HexColor = rl["HexColor"]
    bg = HexColor("#ffffff")
    ink = HexColor("#0f172a")
    accent = HexColor("#7c3aed")

    c.setFillColor(bg)
    c.rect(0, 0, page_w, page_h, fill=1, stroke=0)

    # A single thick accent stripe down the left edge
    c.setFillColor(accent)
    c.rect(0, 0, 12, page_h, fill=1, stroke=0)

    # Tiny "AWARD" eyebrow in accent
    c.setFillColor(accent)
    c.setFont("Helvetica-Bold", 9)
    c.drawCentredString(page_w / 2, page_h - 110, "★  AWARD  ★")

    _text_block(
        c, page_w=page_w, page_h=page_h,
        name=registration.display_name(),
        event_title=event.title,
        event_date=event.starts_at.strftime("%d %B %Y"),
        serial=cert.serial,
        primary_hex=ink, accent_hex=accent,
    )


# ── DESIGN 3: Elegant Script ─────────────────────────────────────
def draw_certificate_elegant(c, page_w, page_h, registration, event, rl, cert):
    HexColor = rl["HexColor"]
    bg = HexColor("#fdf8ef")
    ink = HexColor("#3b2a1f")
    accent = HexColor("#a07c3a")

    c.setFillColor(bg)
    c.rect(0, 0, page_w, page_h, fill=1, stroke=0)

    # Decorative scrolling frame — concentric thin lines, top and bottom only
    c.setStrokeColor(accent)
    for offset, lw in [(35, 1.5), (45, 0.6), (52, 0.4)]:
        c.setLineWidth(lw)
        c.line(offset, page_h - offset, page_w - offset, page_h - offset)
        c.line(offset, offset, page_w - offset, offset)

    # Small flourish in centre top
    c.setFillColor(accent)
    c.setFont("Helvetica-BoldOblique", 18)
    c.drawCentredString(page_w / 2, page_h - 90, "✻")

    _text_block(
        c, page_w=page_w, page_h=page_h,
        name=registration.display_name(),
        event_title=event.title,
        event_date=event.starts_at.strftime("%d %B %Y"),
        serial=cert.serial,
        primary_hex=ink, accent_hex=accent,
        title_font="Times-Italic", name_font="Times-BoldItalic",
        title_text="Certificate of Recognition",
    )


# ── DESIGN 4: Corporate Slate ─────────────────────────────────────
def draw_certificate_corporate(c, page_w, page_h, registration, event, rl, cert):
    HexColor = rl["HexColor"]
    bg = HexColor("#f1f5f9")
    ink = HexColor("#0b1f3a")
    accent = HexColor("#94a3b8")

    c.setFillColor(bg)
    c.rect(0, 0, page_w, page_h, fill=1, stroke=0)

    # Solid navy header band
    c.setFillColor(ink)
    c.rect(0, page_h - 60, page_w, 60, fill=1, stroke=0)
    c.setFillColor(HexColor("#ffffff"))
    c.setFont("Helvetica-Bold", 14)
    c.drawCentredString(page_w / 2, page_h - 38, "CERTIFICATE OF ACHIEVEMENT")

    # Bottom thin double-line
    c.setStrokeColor(ink)
    c.setLineWidth(2.5)
    c.line(60, 95, page_w - 60, 95)
    c.setLineWidth(0.8)
    c.line(60, 90, page_w - 60, 90)

    _text_block(
        c, page_w=page_w, page_h=page_h,
        name=registration.display_name(),
        event_title=event.title,
        event_date=event.starts_at.strftime("%d %B %Y"),
        serial=cert.serial,
        primary_hex=ink, accent_hex=ink,
        title_text="",  # the band already says it
    )


# ── DESIGN 5: Vibrant Geometric ───────────────────────────────────
def draw_certificate_vibrant(c, page_w, page_h, registration, event, rl, cert):
    HexColor = rl["HexColor"]
    bg = HexColor("#ffffff")
    purple = HexColor("#7c3aed")
    cyan = HexColor("#22d3ee")
    coral = HexColor("#fb7185")
    ink = HexColor("#0f172a")

    c.setFillColor(bg)
    c.rect(0, 0, page_w, page_h, fill=1, stroke=0)

    # Top-left coloured triangle (drawn as filled path)
    p = c.beginPath()
    p.moveTo(0, page_h)
    p.lineTo(180, page_h)
    p.lineTo(0, page_h - 180)
    p.close()
    c.setFillColor(purple)
    c.drawPath(p, fill=1, stroke=0)

    # Bottom-right coloured triangle
    p2 = c.beginPath()
    p2.moveTo(page_w, 0)
    p2.lineTo(page_w - 180, 0)
    p2.lineTo(page_w, 180)
    p2.close()
    c.setFillColor(cyan)
    c.drawPath(p2, fill=1, stroke=0)

    # Coral accent circle
    c.setFillColor(coral)
    c.circle(page_w - 90, page_h - 90, 22, fill=1, stroke=0)

    _text_block(
        c, page_w=page_w, page_h=page_h,
        name=registration.display_name(),
        event_title=event.title,
        event_date=event.starts_at.strftime("%d %B %Y"),
        serial=cert.serial,
        primary_hex=ink, accent_hex=purple,
        title_text="Certificate of Excellence",
    )


# ── DESIGN 6: Academic Ribbon ─────────────────────────────────────
def draw_certificate_academic(c, page_w, page_h, registration, event, rl, cert):
    HexColor = rl["HexColor"]
    bg = HexColor("#fdfaf3")
    burgundy = HexColor("#7f1d1d")
    gold = HexColor("#fbbf24")
    ink = HexColor("#1c1917")

    c.setFillColor(bg)
    c.rect(0, 0, page_w, page_h, fill=1, stroke=0)

    # Burgundy single-line border, inset
    c.setStrokeColor(burgundy)
    c.setLineWidth(3)
    c.rect(34, 34, page_w - 68, page_h - 68)

    # Gold ribbon "seal" — circle with two tails — bottom-right
    cx, cy = page_w - 95, 110
    c.setFillColor(gold)
    c.circle(cx, cy, 28, fill=1, stroke=0)
    c.setFillColor(burgundy)
    c.circle(cx, cy, 22, fill=1, stroke=0)
    c.setFillColor(gold)
    c.setFont("Helvetica-Bold", 13)
    c.drawCentredString(cx, cy - 5, "★")
    # Ribbon tails
    p = c.beginPath()
    p.moveTo(cx - 12, cy - 25)
    p.lineTo(cx - 20, cy - 65)
    p.lineTo(cx - 6, cy - 55)
    p.lineTo(cx, cy - 28)
    p.close()
    c.setFillColor(burgundy)
    c.drawPath(p, fill=1, stroke=0)
    p2 = c.beginPath()
    p2.moveTo(cx + 12, cy - 25)
    p2.lineTo(cx + 20, cy - 65)
    p2.lineTo(cx + 6, cy - 55)
    p2.lineTo(cx, cy - 28)
    p2.close()
    c.drawPath(p2, fill=1, stroke=0)

    _text_block(
        c, page_w=page_w, page_h=page_h,
        name=registration.display_name(),
        event_title=event.title,
        event_date=event.starts_at.strftime("%d %B %Y"),
        serial=cert.serial,
        primary_hex=ink, accent_hex=burgundy,
        title_font="Times-Roman", name_font="Times-Bold",
        title_text="Diploma of Completion",
    )


# ── DESIGN 7: Tech Gradient ───────────────────────────────────────
def draw_certificate_tech(c, page_w, page_h, registration, event, rl, cert):
    HexColor = rl["HexColor"]
    bg = HexColor("#0f172a")
    cyan = HexColor("#22d3ee")
    purple = HexColor("#7c3aed")
    paper = HexColor("#f8fafc")

    c.setFillColor(bg)
    c.rect(0, 0, page_w, page_h, fill=1, stroke=0)

    # Stripe gradient simulated via horizontal bars at top
    for i, color_hex in enumerate(["#22d3ee", "#3aa9e2", "#5d80d2", "#7c3aed"]):
        c.setFillColor(HexColor(color_hex))
        c.rect(0, page_h - 8 - (i * 3), page_w, 3, fill=1, stroke=0)

    # Corner brackets
    c.setStrokeColor(cyan)
    c.setLineWidth(2)
    bl = 30
    # top-left
    c.line(40, page_h - 50, 40 + bl, page_h - 50)
    c.line(40, page_h - 50, 40, page_h - 50 - bl)
    # top-right
    c.line(page_w - 40 - bl, page_h - 50, page_w - 40, page_h - 50)
    c.line(page_w - 40, page_h - 50, page_w - 40, page_h - 50 - bl)
    # bottom-left
    c.line(40, 50, 40 + bl, 50)
    c.line(40, 50, 40, 50 + bl)
    # bottom-right
    c.line(page_w - 40 - bl, 50, page_w - 40, 50)
    c.line(page_w - 40, 50, page_w - 40, 50 + bl)

    # Adapted text block for dark background
    c.setFillColor(cyan)
    c.setFont("Helvetica-Bold", 10)
    c.drawCentredString(page_w / 2, page_h - 110, "▸ ACHIEVEMENT UNLOCKED ◂")

    c.setFillColor(paper)
    c.setFont("Helvetica", 22)
    c.drawCentredString(page_w / 2, page_h - 165, "Certificate of Completion")

    c.setFillColor(paper)
    c.setFont("Helvetica-Oblique", 12)
    c.drawCentredString(page_w / 2, page_h - 200, "Awarded to")

    c.setFillColor(cyan)
    c.setFont("Helvetica-Bold", 42)
    c.drawCentredString(page_w / 2, page_h - 260, registration.display_name())

    c.setStrokeColor(purple)
    c.setLineWidth(1)
    c.line(page_w * 0.25, page_h - 272, page_w * 0.75, page_h - 272)

    c.setFillColor(paper)
    c.setFont("Helvetica", 13)
    c.drawCentredString(page_w / 2, page_h - 305, "for completing")
    c.setFont("Helvetica-Bold", 16)
    c.drawCentredString(page_w / 2, page_h - 335, event.title)
    c.setFont("Helvetica", 12)
    c.drawCentredString(page_w / 2, page_h - 360,
                        f"on {event.starts_at.strftime('%d %B %Y')}")

    c.setFillColor(cyan)
    c.setFont("Helvetica-Oblique", 9)
    c.drawString(50, 40, f"Serial: {cert.serial}")
    c.drawRightString(page_w - 50, 40, "Issued via Knock-Knock")


# ── DESIGN 8: Botanical Frame ─────────────────────────────────────
def draw_certificate_botanical(c, page_w, page_h, registration, event, rl, cert):
    HexColor = rl["HexColor"]
    bg = HexColor("#f7f4ed")
    green = HexColor("#14532d")
    sage = HexColor("#a3b18a")
    ink = HexColor("#1c1917")

    c.setFillColor(bg)
    c.rect(0, 0, page_w, page_h, fill=1, stroke=0)

    # Sage thin border
    c.setStrokeColor(sage)
    c.setLineWidth(1.2)
    c.rect(35, 35, page_w - 70, page_h - 70)

    # Stylised leaves in corners (small green ovals)
    def leaf_cluster(x, y, mirror_x=False, mirror_y=False):
        c.saveState()
        c.translate(x, y)
        if mirror_x:
            c.scale(-1, 1)
        if mirror_y:
            c.scale(1, -1)
        c.setFillColor(green)
        for ang, r, dx, dy in [(0, 14, 0, 0), (30, 11, 18, -6), (-30, 11, 18, 6)]:
            c.saveState()
            c.translate(dx, dy)
            c.rotate(ang)
            c.ellipse(-3, -r, 3, r, fill=1, stroke=0)
            c.restoreState()
        c.setFillColor(sage)
        c.circle(0, 0, 3, fill=1, stroke=0)
        c.restoreState()

    leaf_cluster(55, page_h - 55)
    leaf_cluster(page_w - 55, page_h - 55, mirror_x=True)
    leaf_cluster(55, 55, mirror_y=True)
    leaf_cluster(page_w - 55, 55, mirror_x=True, mirror_y=True)

    _text_block(
        c, page_w=page_w, page_h=page_h,
        name=registration.display_name(),
        event_title=event.title,
        event_date=event.starts_at.strftime("%d %B %Y"),
        serial=cert.serial,
        primary_hex=ink, accent_hex=green,
        title_font="Times-Roman", name_font="Times-Bold",
        title_text="Certificate of Participation",
    )


# ── DESIGN 9: Minimal Lines ───────────────────────────────────────
def draw_certificate_minimal_lines(c, page_w, page_h, registration, event, rl, cert):
    HexColor = rl["HexColor"]
    bg = HexColor("#ffffff")
    ink = HexColor("#000000")
    grey = HexColor("#737373")

    c.setFillColor(bg)
    c.rect(0, 0, page_w, page_h, fill=1, stroke=0)

    # Just two long horizontal lines — one near top, one near bottom
    c.setStrokeColor(ink)
    c.setLineWidth(2)
    c.line(60, page_h - 80, page_w - 60, page_h - 80)
    c.line(60, 80, page_w - 60, 80)

    _text_block(
        c, page_w=page_w, page_h=page_h,
        name=registration.display_name(),
        event_title=event.title,
        event_date=event.starts_at.strftime("%d %B %Y"),
        serial=cert.serial,
        primary_hex=ink, accent_hex=grey,
        title_text="Certificate",
    )


# ── DESIGN 10: Celebration Confetti ───────────────────────────────
def draw_certificate_celebration(c, page_w, page_h, registration, event, rl, cert):
    HexColor = rl["HexColor"]
    import random
    bg = HexColor("#ffffff")
    ink = HexColor("#0f172a")
    pink = HexColor("#db2777")
    yellow = HexColor("#facc15")
    blue = HexColor("#0ea5e9")
    colors = [pink, yellow, blue, HexColor("#22c55e"), HexColor("#a855f7")]

    c.setFillColor(bg)
    c.rect(0, 0, page_w, page_h, fill=1, stroke=0)

    # Confetti — deterministic seed so re-renders look the same
    rng = random.Random(7)
    for region in ("top", "bottom"):
        y_min, y_max = (page_h - 80, page_h - 10) if region == "top" else (10, 80)
        for _ in range(60):
            x = rng.uniform(20, page_w - 20)
            y = rng.uniform(y_min, y_max)
            colour = rng.choice(colors)
            c.setFillColor(colour)
            shape = rng.choice(["rect", "circle"])
            if shape == "rect":
                c.saveState()
                c.translate(x, y)
                c.rotate(rng.uniform(0, 360))
                c.rect(-4, -1.5, 8, 3, fill=1, stroke=0)
                c.restoreState()
            else:
                c.circle(x, y, 2.5, fill=1, stroke=0)

    _text_block(
        c, page_w=page_w, page_h=page_h,
        name=registration.display_name(),
        event_title=event.title,
        event_date=event.starts_at.strftime("%d %B %Y"),
        serial=cert.serial,
        primary_hex=ink, accent_hex=pink,
        title_text="🎉 Certificate of Participation 🎉",
    )


# ── Dispatcher ────────────────────────────────────────────────────

CERTIFICATE_RENDERERS = {
    "classic":       draw_certificate_classic,
    "modern":        draw_certificate_modern,
    "elegant":       draw_certificate_elegant,
    "corporate":     draw_certificate_corporate,
    "vibrant":       draw_certificate_vibrant,
    "academic":      draw_certificate_academic,
    "tech":          draw_certificate_tech,
    "botanical":     draw_certificate_botanical,
    "minimal_lines": draw_certificate_minimal_lines,
    "celebration":   draw_certificate_celebration,
}


def _overlay_logo(c, event, rl, page_w, page_h):
    """Paste the event's logo on top of whatever design just rendered.

    Positioning is stored as percentages of the canvas so the logo lands
    in the same visual spot whether we render at A4 landscape or a
    different page size later. We compute the centre and offset by
    half the rendered width so the user's "where I dragged the logo"
    intuition matches the output.
    """
    if not event.certificate_logo:
        return
    try:
        img = rl["ImageReader"](event.certificate_logo.path)
    except Exception:
        logger.exception("Couldn't load certificate logo for event %s", event.pk)
        return

    # Compute logo render size from the % width, preserving aspect ratio.
    target_w = page_w * (event.certificate_logo_width_pct / 100.0)
    iw, ih = img.getSize()
    target_h = target_w * (ih / max(iw, 1))

    # The stored x/y % is the *centre* of the logo from the top-left of
    # the canvas. ReportLab's origin is bottom-left, so we flip y.
    centre_x = page_w * (event.certificate_logo_x_pct / 100.0)
    centre_y_from_top = page_h * (event.certificate_logo_y_pct / 100.0)
    draw_x = centre_x - target_w / 2
    draw_y = page_h - centre_y_from_top - target_h / 2

    c.drawImage(img, draw_x, draw_y, width=target_w, height=target_h,
                mask="auto", preserveAspectRatio=True)


def _render_certificate(registration, cert):
    """Generate the PDF for a cert and attach it to the row.

    No-op if reportlab isn't installed — the Certificate row still gets
    created so the organiser can re-issue once the dependency is available.
    """
    rl = _try_import_reportlab()
    if rl is None:
        logger.info("reportlab not installed — skipping PDF render, serial only.")
        return cert

    event = registration.event
    key = event.certificate_template_key or DEFAULT_CERTIFICATE_TEMPLATE
    renderer = CERTIFICATE_RENDERERS.get(key) or CERTIFICATE_RENDERERS[DEFAULT_CERTIFICATE_TEMPLATE]

    buf = rl["BytesIO"]()
    page_w, page_h = rl["landscape"](rl["A4"])
    c = rl["canvas"].Canvas(buf, pagesize=rl["landscape"](rl["A4"]))

    renderer(c, page_w, page_h, registration, event, rl, cert)
    _overlay_logo(c, event, rl, page_w, page_h)

    c.showPage()
    c.save()
    buf.seek(0)

    cert.pdf_file.save(
        f"cert-{cert.serial}.pdf",
        rl["ContentFile"](buf.read()),
        save=True,
    )
    return cert


def generate_certificate(registration):
    """
    Create (or return existing) Certificate for a checked-in attendee.

    Uses the event's chosen template key, then overlays the optional
    logo. The PDF is only re-rendered if it's missing — re-calling this
    is safe and cheap for already-rendered certs.
    """
    if registration.status != Registration.STATUS_CHECKED_IN:
        raise ValueError("Only checked-in attendees can receive a certificate.")

    cert, created = Certificate.objects.get_or_create(registration=registration)
    if not created and cert.pdf_file:
        return cert
    return _render_certificate(registration, cert)


def regenerate_certificate(registration):
    """
    Force a re-render — used after the organiser changes the template
    or logo position. Drops the existing PDF and renders fresh.
    """
    if registration.status != Registration.STATUS_CHECKED_IN:
        raise ValueError("Only checked-in attendees can receive a certificate.")
    cert, _ = Certificate.objects.get_or_create(registration=registration)
    if cert.pdf_file:
        cert.pdf_file.delete(save=False)
    return _render_certificate(registration, cert)


def render_certificate_preview_png(event, *, template_key=None,
                                   logo_x=None, logo_y=None, logo_width=None,
                                   sample_name="Sample Attendee"):
    """
    Render a *preview* PNG for the organiser's picker UI.

    We render to PDF via the same renderers (so what they see is what
    they get) then convert page 1 to a PNG. If PDF→PNG conversion
    libraries aren't installed we fall back to returning the PDF bytes
    — the picker will then download instead of preview.

    Returns (bytes, mime_type).
    """
    rl = _try_import_reportlab()
    if rl is None:
        return (b"", "application/octet-stream")

    # Mutate a *copy* of the relevant fields so we don't persist anything.
    class _Stub:
        pass
    stub_event = _Stub()
    for attr in ("title", "starts_at", "certificate_logo",
                 "certificate_logo_x_pct", "certificate_logo_y_pct",
                 "certificate_logo_width_pct"):
        setattr(stub_event, attr, getattr(event, attr))
    stub_event.certificate_template_key = template_key or event.certificate_template_key
    if logo_x is not None:
        stub_event.certificate_logo_x_pct = float(logo_x)
    if logo_y is not None:
        stub_event.certificate_logo_y_pct = float(logo_y)
    if logo_width is not None:
        stub_event.certificate_logo_width_pct = float(logo_width)

    stub_reg = _Stub()
    stub_reg.event = stub_event

    def _display_name():
        return sample_name
    stub_reg.display_name = _display_name

    stub_cert = _Stub()
    stub_cert.serial = "KK-PREVIEW-0000"

    renderer = (CERTIFICATE_RENDERERS.get(stub_event.certificate_template_key)
                or CERTIFICATE_RENDERERS[DEFAULT_CERTIFICATE_TEMPLATE])

    buf = rl["BytesIO"]()
    page_w, page_h = rl["landscape"](rl["A4"])
    c = rl["canvas"].Canvas(buf, pagesize=rl["landscape"](rl["A4"]))
    renderer(c, page_w, page_h, stub_reg, stub_event, rl, stub_cert)
    _overlay_logo(c, stub_event, rl, page_w, page_h)
    c.showPage()
    c.save()
    buf.seek(0)
    return (buf.read(), "application/pdf")


def _try_import_playwright():
    """Single import point for the optional Playwright dependency.

    Returns a tuple (sync_playwright, Error) where:
      - sync_playwright is the context-manager entry point.
      - Error is Playwright's base exception class, used to catch
        browser-launch failures separately from generic Exceptions.
    Returns (None, None) when the package isn't installed at all.
    """
    try:
        from playwright.sync_api import sync_playwright, Error
        return sync_playwright, Error
    except ImportError:
        return None, None


def _render_agenda_via_browser(request, event, *, theme: str, output: str):
    """
    Spin up headless Chromium, point it at the agenda print page, and
    return the rendered bytes.

    Args:
        request: the Django HttpRequest — used to build the absolute URL
                 and to forward the user's session cookie so the print
                 page (which is @login_required) authenticates.
        event:   AttendanceEvent
        theme:   "dark" or "light"
        output:  "pdf" or "png"

    Returns:
        (bytes, content_type, file_ext)

    Raises:
        RuntimeError with a human-readable message when:
          - Playwright isn't installed at all, or
          - Playwright is installed but the Chromium binary isn't on
            disk (most commonly because `playwright install chromium`
            was never run inside the runtime environment).
        The view catches RuntimeError and turns it into a flash
        message + redirect, instead of returning a 500.
    """
    sync_playwright, PlaywrightError = _try_import_playwright()
    if sync_playwright is None:
        raise RuntimeError(
            "Playwright is not installed. Run "
            "`pip install playwright && playwright install chromium`."
        )

    # Build the absolute URL of the print page, including the theme
    # query so the page renders the right palette. We use the existing
    # `agenda_print` URL name (registered in urls.py).
    from django.urls import reverse
    qs = urlencode({"theme": theme})
    print_url = request.build_absolute_uri(
        reverse("attendance:agenda_print", kwargs={"pk": event.pk}) + f"?{qs}"
    )

    # Forward the session + CSRF cookies so the headless browser is
    # authenticated as the same organiser. Without this, the print
    # page hits the login redirect and we'd render a login screen.
    cookies = []
    domain = request.get_host().split(":")[0]
    for name in ("sessionid", "csrftoken"):
        if name in request.COOKIES:
            cookies.append({
                "name": name,
                "value": request.COOKIES[name],
                "domain": domain,
                "path": "/",
            })

    with sync_playwright() as p:
        # Most common failure mode at this line: the Python package is
        # installed but the browser binary isn't on disk yet, because
        # `playwright install chromium` was never run inside the image.
        # Translate that into a RuntimeError so the view shows a
        # friendly flash message instead of returning a 500.
        try:
            browser = p.chromium.launch(args=["--no-sandbox"])
        except PlaywrightError as e:
            logger.exception("Playwright failed to launch Chromium")
            raise RuntimeError(
                "The Chromium browser used to render the agenda isn't "
                "available on the server. An administrator needs to run "
                "`playwright install chromium` inside the running "
                "container, or rebuild the image with "
                "`RUN playwright install --with-deps chromium` in the "
                f"Dockerfile. (Underlying error: {e})"
            ) from e

        try:
            context = browser.new_context(
                viewport={"width": 900, "height": 1200},
                device_scale_factor=2,  # crisper PNGs / sharper PDFs
            )
            if cookies:
                context.add_cookies(cookies)

            page = context.new_page()
            page.goto(print_url, wait_until="networkidle", timeout=15000)
            # Page sets body[data-render-ready=1] once fonts have loaded.
            try:
                page.wait_for_selector(
                    "body[data-render-ready='1']", timeout=5000,
                )
            except Exception:
                # Don't hard-fail if the signal doesn't fire — networkidle
                # is usually enough. Continue with whatever's painted.
                logger.debug("agenda_print render_ready signal not seen")

            if output == "pdf":
                # Emulate print so any (future) @media print rules apply.
                page.emulate_media(media="print")
                data = page.pdf(
                    format="A4",
                    print_background=True,
                    margin={"top": "14mm", "right": "12mm",
                            "bottom": "14mm", "left": "12mm"},
                )
                return data, "application/pdf", "pdf"

            elif output == "png":
                data = page.screenshot(full_page=True, type="png")
                return data, "image/png", "png"

            else:
                raise ValueError(f"Unknown output format: {output!r}")
        finally:
            browser.close()


def render_agenda_pdf(request, event, *, theme: str = "dark") -> bytes:
    """Public helper: render the agenda as a PDF in the chosen theme."""
    data, _ct, _ext = _render_agenda_via_browser(
        request, event, theme=theme, output="pdf",
    )
    return data


def render_agenda_png(request, event, *, theme: str = "dark") -> bytes:
    """Public helper: render the agenda as a full-page PNG screenshot."""
    data, _ct, _ext = _render_agenda_via_browser(
        request, event, theme=theme, output="png",
    )
    return data