"""
Views.

Three groups, separated by who they're for:

  ORGANIZER-SIDE  (login_required, owner-only)
    list, create, edit, detail (the live dashboard), form_builder,
    registrations table, approve/decline, manual check-in, announcements,
    export, certificates, status transitions.
    Plus the analytics JSON endpoint that feeds the dashboard charts,
    the QR-poster print view, and the certificate picker + preview.

  ATTENDEE-SIDE  (public)
    public_register  — fills the form
    public_qr        — the projected/printed QR for the venue
    public_qr_poster — printable A4 sheet wrapping the QR
    ticket           — the attendee's personal page with their personal QR
    public_check_in  — what the event-level QR ultimately routes to
                       (now geofence-gated when configured)
    attendee_check_in — what a personal QR routes to (also geofence-gated)
    public_geofence_required — landing page when an attendee scans
                       outside the radius

  JSON ENDPOINTS  (used by the drag-and-drop form builder + dashboard)
    field_add_preset, field_add_custom, field_reorder,
    field_edit, field_delete, event_stats_json
"""

import csv
import json
import uuid
from collections import Counter, defaultdict
from datetime import timedelta

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.db import transaction
from django.db.models import Max
from django.http import (
    FileResponse, Http404, HttpResponse, HttpResponseBadRequest, JsonResponse,
)
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.utils.text import slugify
from django.views.decorators.clickjacking import xframe_options_sameorigin
from django.views.decorators.http import require_GET, require_POST

from .forms import (
    AgendaItemForm, AnnouncementForm, DynamicRegistrationForm, EventFieldForm,
    EventForm, QuickCheckInForm, AgendaDayForm,
)
from .models import (
    AGENDA_TEMPLATES, AGENDA_TEMPLATE_KEYS, AgendaItem,
    AttendanceEvent, CERTIFICATE_TEMPLATES, Certificate, CheckIn, EventField,
    PRESET_FIELDS, Registration, RegistrationAnswer, AgendaDay,
)
from . import services
from .feedback_views import should_route_to_feedback


# ─────────────────── helpers ───────────────────

def _own_event_or_404(user, pk):
    return get_object_or_404(AttendanceEvent, pk=pk, owner=user)


def _public_event_or_404(token):
    return get_object_or_404(AttendanceEvent, public_token=token)


def _registration_or_404(token):
    """
    Resolve a personal-ticket token (a string from the URL) to a
    Registration.

    The /t/ routes use <str:token> rather than <uuid:token> so that
    non-canonical forms — uppercase, or the 32-char dashless form a QR
    scanner sometimes yields — reach the view instead of being rejected
    by the router with an opaque 404. We normalise here: anything that
    isn't a parseable UUID, or doesn't match a row, gets a clean 404.
    """
    try:
        normalised = uuid.UUID(str(token))
    except (ValueError, AttributeError, TypeError):
        raise Http404("Invalid ticket link.")
    return get_object_or_404(Registration, token=normalised)


def _next_field_order(event):
    """The next slot at the bottom of the form."""
    current_max = event.fields.aggregate(m=Max("order"))["m"] or 0
    return current_max + 1


def _parse_coords(request):
    """
    Pull (lat, lng) out of a request — POST first, then GET fallback.
    Returns (lat, lng) as floats, or (None, None) if absent/malformed.
    Used by the geofence check-in flow.
    """
    raw_lat = (request.POST.get("lat") or request.GET.get("lat") or "").strip()
    raw_lng = (request.POST.get("lng") or request.GET.get("lng") or "").strip()
    if not raw_lat or not raw_lng:
        return (None, None)
    try:
        return (float(raw_lat), float(raw_lng))
    except (TypeError, ValueError):
        return (None, None)


def _device_token(request):
    """
    Read the client-generated device token from the request.

    The check-in pages create a random token in the browser's
    localStorage and send it back on every check-in (hidden form field
    on POST, query string on GET). It is not a hardware id — it just
    lets the per-day dedup recognise the same browser. Returns "" when
    absent (e.g. storage disabled), which the dedup treats as exempt.
    """
    raw = (request.POST.get("device_token")
           or request.GET.get("device_token") or "").strip()
    # Keep it bounded and simple — the field is max_length=64.
    return raw[:64]


def _ensure_default_day(event):
    """Return the day this event's legacy editor should target.

    Behaviour:
      • If the event has zero days, create one using
        event.starts_at.date() as the date and an empty label
        (no header rendered). This is what the data migration would
        have produced for legacy events.
      • Otherwise return the first day by order, which is what the
        legacy single-day editor was implicitly always targeting.

    This is the bridge that keeps the pre-multi-day editor working
    until Batch 2 replaces it with proper day management.
    """
    day = event.agenda_days.order_by("order", "date", "id").first()
    if day:
        return day
    return event.agenda_days.create(
        date=event.starts_at.date(),
        label="",
        order=0,
    )


# ────────────── date-window helpers for the stats endpoint ──────────────

# Hard cap on how many points the timeline may return, so `range=all`
# on a long-running event can't build a multi-thousand-point series.
MAX_TIMELINE_DAYS = 366


def _local_time(dt):
    """Aware datetime → local datetime. Naive values pass straight through."""
    if dt is None:
        return None
    if timezone.is_naive(dt):
        return dt
    return timezone.localtime(dt)


def _local_date(dt):
    """The calendar date `dt` falls on, in the project's local timezone."""
    local = _local_time(dt)
    return local.date() if local is not None else None


def _event_data_window(event, reg_list):
    """
    (first_day, last_day) of the window in which this event can hold data.

    `last_day` — the "data horizon" — is the event's end date, pushed out
    if a row somehow landed later (clock skew, a late manual check-in,
    ends_at edited backwards), and clamped to today. Once the horizon is
    in the past nothing about this event can change, which is what lets
    the dashboard stop the series there instead of drawing zeroes up to
    today.

    `first_day` is the earliest date carrying data, falling back to the
    event's start date so a brand-new event still has a valid window.
    """
    today = _local_date(timezone.now())

    first_day = _local_date(event.starts_at)
    last_day = _local_date(event.ends_at)
    if last_day < first_day:
        last_day = first_day

    for r in reg_list:
        stamps = [r.registered_at]
        if r.checked_in_at:
            stamps.append(r.checked_in_at)
        for ts in stamps:
            d = _local_date(ts)
            if d is None:
                continue
            if d > last_day:
                last_day = d
            if d < first_day:
                first_day = d

    last_day = min(last_day, today)
    first_day = min(first_day, last_day)
    return first_day, last_day


# ═══════════════════════════════════════════════════════════════
# ORGANIZER-SIDE
# ═══════════════════════════════════════════════════════════════

@login_required
def event_list(request):
    """All of the current user's events, newest first."""
    events = (
        AttendanceEvent.objects
        .filter(owner=request.user)
        .order_by("-starts_at")
    )
    return render(request, "attendance/event_list.html", {"events": events})


@login_required
def event_create(request):
    if request.method == "POST":
        form = EventForm(request.POST, request.FILES, user=request.user)
        if form.is_valid():
            event = form.save(commit=False)
            event.owner = request.user
            _apply_venue_defaults(event, form.cleaned_data.get("venue"))
            event.save()
            messages.success(request, f"Event '{event.title}' created. Now build the registration form.")
            return redirect("attendance:form_builder", pk=event.pk)
    else:
        form = EventForm(user=request.user)
    return render(request, "attendance/event_form.html", {
        "form": form, "is_new": True,
        "certificate_templates": CERTIFICATE_TEMPLATES,
    })


@login_required
def event_edit(request, pk):
    event = _own_event_or_404(request.user, pk)
    if request.method == "POST":
        form = EventForm(request.POST, request.FILES, instance=event, user=request.user)
        if form.is_valid():
            event = form.save(commit=False)
            _apply_venue_defaults(event, form.cleaned_data.get("venue"))
            event.save()
            form.save_m2m()
            messages.success(request, "Event updated.")
            return redirect("attendance:event_detail", pk=event.pk)
    else:
        form = EventForm(instance=event, user=request.user)
    return render(request, "attendance/event_form.html", {
        "form": form, "event": event, "is_new": False,
        "certificate_templates": CERTIFICATE_TEMPLATES,
    })


def _apply_venue_defaults(event, venue):
    """
    Inherit the venue's lat/lng/radius (and address) onto the event when
    the organizer didn't override them on the form. The organizer's
    explicit values always win — this only fills *blanks*.

    We copy the values onto the event's own columns rather than relying
    on the FK because:
      - if the venue is later deactivated, the event keeps working
      - the existing geofence code reads event.geofence_lat/lng/radius
        directly, so we don't have to touch is_within_geofence().
    """
    if not venue:
        return
    if event.geofence_lat is None:
        event.geofence_lat = venue.latitude
    if event.geofence_lng is None:
        event.geofence_lng = venue.longitude
    if not event.geofence_radius_m:
        event.geofence_radius_m = venue.default_radius_m
    if not event.location and venue.address:
        event.location = venue.address


@login_required
def event_detail(request, pk):
    """The organizer's live dashboard for one event."""
    event = _own_event_or_404(request.user, pk)
    regs = (
        event.registrations
        .select_related("user")
        # Prefetched for the attendee-detail modal: per-day check-in
        # history and the answers the attendee gave on the reg form.
        .prefetch_related("check_ins__agenda_day", "answers__field")
        .order_by("-registered_at")
    )

    accepted = [r for r in regs if r.status in (
        Registration.STATUS_ACCEPTED, Registration.STATUS_CHECKED_IN,
    )]

    # Per-attendee detail payloads for the modal. Built here (rather than
    # hand-assembled as JSON in the template) so Django's json_script can
    # serialise them safely — no escaping pitfalls.
    attendee_details = {}
    for r in accepted:
        attendee_details[r.pk] = {
            "name": r.display_name(),
            "email": r.email,
            "phone": r.phone,
            "status": r.get_status_display(),
            "is_walk_in": r.is_walk_in,
            "registered": r.registered_at.strftime("%-d %b %Y, %H:%M"),
            "checkins": [
                {
                    "day": (c.agenda_day.label if c.agenda_day
                            and c.agenda_day.label else str(c.day)),
                    "date": c.day.strftime("%-d %b %Y"),
                    "time": c.checked_in_at.strftime("%H:%M"),
                    "method": c.get_method_display(),
                }
                for c in r.check_ins.all()
            ],
            "answers": [
                {"label": a.field.label, "value": a.value}
                for a in r.answers.all()
            ],
        }

    # Build the QR URL that gets projected/printed at the venue.
    public_qr_target = request.build_absolute_uri(
        reverse("attendance:public_check_in", kwargs={"public_token": event.public_token})
    )

    return render(request, "attendance/event_detail.html", {
        "event": event,
        "registrations": regs,
        "registrations_pending": [r for r in regs if r.status == Registration.STATUS_PENDING],
        "registrations_accepted": accepted,
        "attendee_details": attendee_details,
        "checked_in_count": event.checked_in_count(),
        "accepted_count": event.accepted_count(),
        "pending_count": event.pending_count(),
        "declined_count": event.declined_count(),
        "walk_in_count": event.walk_in_count(),
        "seats_remaining": event.seats_remaining(),
        "public_register_url": request.build_absolute_uri(event.get_public_register_url()),
        "public_check_in_url": public_qr_target,
        "announcement_form": AnnouncementForm(),
    })


# ── Form builder ────────────────────────────────────────────────

@login_required
def form_builder(request, pk):
    """Drag-and-drop page where the organizer assembles the registration form."""
    event = _own_event_or_404(request.user, pk)
    fields = event.fields.all()
    # Hide presets they've already added so the panel doesn't duplicate.
    used_keys = {f.preset_key for f in fields if f.preset_key}
    available_presets = [p for p in PRESET_FIELDS if p["key"] not in used_keys]
    return render(request, "attendance/form_builder.html", {
        "event": event,
        "fields": fields,
        "presets": available_presets,
        "field_types": EventField.TYPE_CHOICES,
    })


@login_required
@require_POST
def field_add_preset(request, pk):
    """Drop a preset from the right panel into the form."""
    event = _own_event_or_404(request.user, pk)
    key = (request.POST.get("preset_key") or "").strip()
    preset = next((p for p in PRESET_FIELDS if p["key"] == key), None)
    if not preset:
        return HttpResponseBadRequest("Unknown preset.")
    if event.fields.filter(preset_key=key).exists():
        return JsonResponse({"ok": False, "error": "Already added."}, status=400)

    field = EventField.objects.create(
        event=event,
        preset_key=preset["key"],
        label=preset["label"],
        field_type=preset["field_type"],
        required=preset.get("required", False),
        options="\n".join(preset.get("options", [])),
        order=_next_field_order(event),
    )
    return JsonResponse({"ok": True, "field": _field_to_json(field)})


@login_required
@require_POST
def field_add_custom(request, pk):
    """Add a fresh custom field (the 'customize' button)."""
    event = _own_event_or_404(request.user, pk)
    field = EventField.objects.create(
        event=event,
        label=request.POST.get("label", "Untitled question"),
        field_type=request.POST.get("field_type", EventField.TYPE_TEXT),
        required=request.POST.get("required") == "on",
        order=_next_field_order(event),
    )
    return JsonResponse({"ok": True, "field": _field_to_json(field)})


@login_required
@require_POST
def field_edit(request, pk, field_id):
    event = _own_event_or_404(request.user, pk)
    field = get_object_or_404(EventField, pk=field_id, event=event)
    form = EventFieldForm(request.POST, instance=field)
    if not form.is_valid():
        return JsonResponse({"ok": False, "errors": form.errors}, status=400)
    form.save()
    return JsonResponse({"ok": True, "field": _field_to_json(field)})


@login_required
@require_POST
def field_delete(request, pk, field_id):
    """
    Hard-delete a form field plus any answers attendees gave for it.

    We do a select-then-delete so we can return a sensible 404 if the
    field doesn't belong to this event. The previous version silently
    returned ok=True on a missing field, which is what made delete *seem*
    broken from the UI: a race or a stale pk would look successful but
    nothing was removed. We now do the lookup explicitly.
    """
    event = _own_event_or_404(request.user, pk)
    field = get_object_or_404(EventField, pk=field_id, event=event)
    field.delete()
    return JsonResponse({"ok": True, "deleted_id": field_id})


@login_required
@require_POST
def field_reorder(request, pk):
    """Save the new drag order. Body: {"order": [3, 5, 2, 1]}."""
    event = _own_event_or_404(request.user, pk)
    try:
        payload = json.loads(request.body or "{}")
        ids = payload.get("order") or []
    except ValueError:
        return HttpResponseBadRequest("Bad JSON.")

    with transaction.atomic():
        for index, field_id in enumerate(ids):
            EventField.objects.filter(pk=field_id, event=event).update(order=index)
    return JsonResponse({"ok": True})


def _field_to_json(field):
    return {
        "id": field.pk,
        "label": field.label,
        "field_type": field.field_type,
        "type_display": field.get_field_type_display(),
        "required": field.required,
        "help_text": field.help_text,
        "placeholder": field.placeholder,
        "options": field.options,
        "preset_key": field.preset_key,
        "order": field.order,
    }


# ── Status transitions ──────────────────────────────────────────

@login_required
@require_POST
def event_set_status(request, pk):
    """Open, close, mark live, end. Triggered by the dashboard buttons."""
    event = _own_event_or_404(request.user, pk)
    new_status = (request.POST.get("status") or "").strip()
    if new_status not in dict(AttendanceEvent.STATUS_CHOICES):
        return HttpResponseBadRequest("Invalid status.")

    event.status = new_status
    event.save(update_fields=["status"])
    messages.success(request, f"Event status set to '{event.get_status_display()}'.")

    if new_status == AttendanceEvent.STATUS_ENDED:
        # Tell every open ticket page that the QR no longer works.
        services.broadcast_to_event(event, {
            "type": "event_ended",
            "message": "This event has ended.",
        })
    return redirect("attendance:event_detail", pk=event.pk)


# ── Approve / decline / manual check-in ─────────────────────────

@login_required
@require_POST
def registration_action(request, pk, reg_id):
    """Approve, decline, manual check-in, or cancel a registration."""
    event = _own_event_or_404(request.user, pk)
    reg = get_object_or_404(Registration, pk=reg_id, event=event)
    action = (request.POST.get("action") or "").lower()

    if action == "accept":
        if event.capacity and event.accepted_count() >= event.capacity:
            messages.error(request, "Capacity reached — can't accept more.")
        else:
            reg.mark_accepted()
            services.send_acceptance_email(reg, request=request)
            services.broadcast_new_registration(reg)
            messages.success(request, f"{reg.display_name()} accepted.")
    elif action == "decline":
        reg.status = Registration.STATUS_DECLINED
        reg.save(update_fields=["status"])
        services.send_decline_email(reg, request=request)
        messages.info(request, f"{reg.display_name()} declined.")
    elif action == "check_in":
        # Organiser-driven check-in is *not* subject to geofencing — they're
        # taking responsibility for the person being in the room.
        if reg.status == Registration.STATUS_PENDING:
            reg.mark_accepted(save=False)  # auto-accept on manual check-in
        reg.mark_checked_in()
        services.broadcast_check_in(reg)
        messages.success(request, f"{reg.display_name()} marked present.")
    elif action == "uncheck_in":
        reg.status = Registration.STATUS_ACCEPTED
        reg.checked_in_at = None
        reg.save(update_fields=["status", "checked_in_at"])
        messages.info(request, f"{reg.display_name()} reverted to accepted.")
    elif action == "cancel":
        reg.status = Registration.STATUS_CANCELLED
        reg.save(update_fields=["status"])
        messages.info(request, f"{reg.display_name()} cancelled.")
    else:
        return HttpResponseBadRequest("Unknown action.")

    return redirect("attendance:event_detail", pk=event.pk)


# ── Announcements ──────────────────────────────────────────────

@login_required
@require_POST
def announcement_send(request, pk):
    event = _own_event_or_404(request.user, pk)
    form = AnnouncementForm(request.POST)
    if not form.is_valid():
        messages.error(request, "Please fix the announcement form.")
        return redirect("attendance:event_detail", pk=event.pk)
    services.send_announcement(
        event,
        subject=form.cleaned_data["subject"],
        body=form.cleaned_data["body"],
        channel=form.cleaned_data["channel"],
        audience=form.cleaned_data["audience"],
        sender=request.user,
    )
    messages.success(request, "Announcement sent.")
    return redirect("attendance:event_detail", pk=event.pk)


# ── Export + certificates ──────────────────────────────────────

@login_required
def registrations_export(request, pk):
    """CSV of all registrations with all dynamic answers."""
    event = _own_event_or_404(request.user, pk)
    fields = list(event.fields.all().order_by("order"))

    response = HttpResponse(content_type="text/csv")
    safe_title = event.title.replace('"', '').replace(",", "")[:60]
    response["Content-Disposition"] = (
        f'attachment; filename="attendance-{safe_title}.csv"'
    )

    writer = csv.writer(response)
    header = ["Name", "Email", "Phone", "Status",
              "Registered at", "Checked in at", "Walk-in"]
    header += [f.label for f in fields]
    writer.writerow(header)

    regs = (
        event.registrations
        .prefetch_related("answers__field")
        .order_by("registered_at")
    )
    for r in regs:
        answer_map = {a.field_id: a.value for a in r.answers.all()}
        row = [
            r.full_name, r.email, r.phone, r.get_status_display(),
            r.registered_at.strftime("%Y-%m-%d %H:%M") if r.registered_at else "",
            r.checked_in_at.strftime("%Y-%m-%d %H:%M") if r.checked_in_at else "",
            "yes" if r.is_walk_in else "no",
        ]
        row += [answer_map.get(f.pk, "") for f in fields]
        writer.writerow(row)
    return response


@login_required
@xframe_options_sameorigin
def certificate_download(request, pk, reg_id):
    """
    Serve an attendee's certificate PDF.

    Previously this redirected to `cert.pdf_file.url` (i.e. /media/...).
    Two problems with that for the in-page preview:

      1. Django's XFrameOptionsMiddleware sets X-Frame-Options: DENY by
         default, so the browser refuses to embed the media response in
         our same-origin iframe — Firefox shows the "another site has
         embedded it" warning. Setting @xframe_options_sameorigin on the
         redirect response doesn't help because the *media* response is
         what actually paints inside the iframe.
      2. /media/ isn't always served by Django (whitenoise covers static
         only), so the header story depends on what's fronting media.

    Streaming the PDF straight from this view sidesteps both problems —
    we own the headers, and the response that paints in the iframe is
    the one wearing the sameorigin allowance.

    `?download=1` (or any truthy value) flips to attachment disposition
    so a "Download" link can force a save even if the browser would
    otherwise display the PDF inline.
    """
    event = _own_event_or_404(request.user, pk)
    reg = get_object_or_404(Registration, pk=reg_id, event=event)
    if reg.status != Registration.STATUS_CHECKED_IN:
        messages.error(request, "Certificates are only available to checked-in attendees.")
        return redirect("attendance:event_detail", pk=event.pk)
    cert = services.generate_certificate(reg)
    if not cert.pdf_file:
        messages.warning(
            request,
            f"Certificate issued (serial {cert.serial}) — install reportlab to render PDFs.",
        )
        return redirect("attendance:event_detail", pk=event.pk)

    # Open the saved PDF and stream it back. FileResponse handles the
    # Content-Type, Content-Length and range requests for us.
    force_download = bool(request.GET.get("download"))
    safe_name = (reg.full_name or reg.email or f"attendee-{reg.pk}").replace('"', "")
    filename = f"certificate-{safe_name}.pdf"
    response = FileResponse(
        cert.pdf_file.open("rb"),
        as_attachment=force_download,
        filename=filename,
        content_type="application/pdf",
    )
    return response


@login_required
@require_POST
def certificates_bulk(request, pk):
    """Generate certificates for everyone checked in.

    Honours the current template + logo settings — meaning the organiser
    can change the design, click 'Generate for all', and everyone gets a
    fresh cert in the new style.
    """
    event = _own_event_or_404(request.user, pk)
    if not event.generate_certificates:
        messages.error(request, "Enable certificates on the event first.")
        return redirect("attendance:event_detail", pk=event.pk)
    count = 0
    for reg in event.registrations.filter(status=Registration.STATUS_CHECKED_IN):
        try:
            services.regenerate_certificate(reg)
            count += 1
        except Exception:
            continue
    messages.success(request, f"Generated {count} certificate(s).")
    return redirect("attendance:event_detail", pk=event.pk)


@login_required
def certificate_picker(request, pk):
    """
    Side-by-side picker showing all 10 designs as preview thumbnails
    plus the drag-to-position logo overlay editor.
    """
    event = _own_event_or_404(request.user, pk)
    return render(request, "attendance/certificate_picker.html", {
        "event": event,
        "templates": CERTIFICATE_TEMPLATES,
    })


@login_required
@require_GET
@xframe_options_sameorigin
def certificate_preview(request, pk):
    """
    Render a *preview* of the certificate as PDF (for the picker's iframe).

    Accepts GET overrides so the picker can preview adjustments without
    saving: ?template=modern&logo_x=50&logo_y=8&logo_width=15

    The @xframe_options_sameorigin decorator is essential — without it,
    Django's default XFrameOptionsMiddleware sends `DENY` and browsers
    refuse to render the PDF inside the picker's iframe, which is why
    Firefox shows the "Can't Open This Page" fox.
    """
    event = _own_event_or_404(request.user, pk)

    def _maybe_float(name):
        raw = request.GET.get(name)
        if raw in (None, ""):
            return None
        try:
            return float(raw)
        except ValueError:
            return None

    data, mime = services.render_certificate_preview_png(
        event,
        template_key=request.GET.get("template"),
        logo_x=_maybe_float("logo_x"),
        logo_y=_maybe_float("logo_y"),
        logo_width=_maybe_float("logo_width"),
    )
    if not data:
        return HttpResponse("Install reportlab to enable previews.",
                            content_type="text/plain", status=501)
    resp = HttpResponse(data, content_type=mime)
    # Inline so the iframe renders it; not an attachment.
    resp["Content-Disposition"] = 'inline; filename="certificate-preview.pdf"'
    return resp


# ── Agenda editor ──────────────────────────────────────────────

@login_required
def agenda_editor(request, pk):
    """Standalone page for managing the structured agenda + visual template.

    Context exposes BOTH `items` (flat list — what the legacy editor
    template iterates) AND `days` (grouped — what the Batch 2 editor
    will iterate). Keeping both means we can ship the data-layer
    multi-day support without breaking the existing UI.
    """
    event = _own_event_or_404(request.user, pk)
    return render(request, "attendance/agenda_editor.html", {
        "event": event,
        # Flat list — used by the legacy template that doesn't know
        # about days yet. Pulled from AgendaItem directly so we get
        # items regardless of whether they have a day FK set.
        "items": AgendaItem.objects.filter(event=event).order_by(
            "day__order", "day__date", "order", "start_time",
        ),
        # Day-grouped — used by the upcoming day-aware editor.
        "days": event.agenda_days.prefetch_related("items").all(),
        "templates": AGENDA_TEMPLATES,
    })


def _agenda_item_to_json(item):
    return {
        "id": item.pk,
        "order": item.order,
        "start_time": item.start_time.strftime("%H:%M") if item.start_time else "",
        "end_time": item.end_time.strftime("%H:%M") if item.end_time else "",
        "title": item.title,
        "description": item.description,
        "speaker": item.speaker,
        "track": item.track,
        "accent_colour": item.accent_colour,
        "status": item.status,
        "duration_label": item.duration_label,
    }


@login_required
@require_POST
def agenda_item_add(request, pk):
    """Create a new agenda row.

    Accepts an optional `day_id` POST param. When supplied (the new
    multi-day editor), the item attaches to that day. When omitted
    (the legacy single-day editor), the item attaches to the event's
    first day, creating a default day on the fly if none exists.

    This forgiveness is intentional — it keeps the existing UI alive
    until Batch 2 ships a day-aware editor. The new editor SHOULD
    always send day_id explicitly; if it doesn't, we still recover.
    """
    event = _own_event_or_404(request.user, pk)

    day_id = request.POST.get("day_id")
    if day_id:
        try:
            day = event.agenda_days.get(pk=day_id)
        except AgendaDay.DoesNotExist:
            return JsonResponse(
                {"ok": False, "error": "Day not found on this event."}, status=404,
            )
    else:
        # Legacy editor path: pick (or create) the default day.
        day = _ensure_default_day(event)

    form = AgendaItemForm(request.POST)
    if not form.is_valid():
        return JsonResponse({
            "ok": False,
            "error": "; ".join(f"{k}: {v[0]}" for k, v in form.errors.items()),
        }, status=400)

    item = form.save(commit=False)
    item.event = event
    item.day = day
    item.order = (day.items.aggregate(Max("order"))["order__max"] or 0) + 1
    item.save()
    return JsonResponse({"ok": True, "item": _agenda_item_to_json(item)})


@login_required
@require_POST
def agenda_item_edit(request, pk, item_id):
    event = _own_event_or_404(request.user, pk)
    item = get_object_or_404(AgendaItem, pk=item_id, event=event)
    form = AgendaItemForm(request.POST, instance=item)
    if not form.is_valid():
        return JsonResponse({
            "ok": False,
            "error": "; ".join(f"{k}: {v[0]}" for k, v in form.errors.items()),
        }, status=400)
    form.save()
    return JsonResponse({"ok": True, "item": _agenda_item_to_json(item)})


@login_required
@require_POST
def agenda_item_delete(request, pk, item_id):
    event = _own_event_or_404(request.user, pk)
    item = get_object_or_404(AgendaItem, pk=item_id, event=event)
    item.delete()
    return JsonResponse({"ok": True, "deleted_id": item_id})


@login_required
@require_POST
def agenda_reorder(request, pk):
    """Save drag-order for items.

    Body: {"order": [3, 1, 2], "day_id": 7}   ← new editor
    Body: {"order": [3, 1, 2]}                ← legacy editor

    When `day_id` is omitted, the reorder applies within the event's
    first day. With only one day, this matches the pre-multi-day
    behaviour exactly. With multiple days, the legacy editor would
    only have shown items from one day at a time anyway, so this
    stays consistent.
    """
    event = _own_event_or_404(request.user, pk)
    try:
        payload = json.loads(request.body or "{}")
        day_id = payload.get("day_id")
        ids = payload.get("order") or []
    except ValueError:
        return HttpResponseBadRequest("Bad JSON.")

    if day_id:
        if not event.agenda_days.filter(pk=day_id).exists():
            return JsonResponse(
                {"ok": False, "error": "Day not found on this event."}, status=404,
            )
        scope = {"day_id": day_id}
    else:
        # Legacy editor: scope to the first day if there is one.
        # If there isn't, fall back to all event items (handles the
        # tiny window where data migration is mid-flight).
        first_day = event.agenda_days.order_by("order", "date", "id").first()
        scope = {"day_id": first_day.pk} if first_day else {}

    with transaction.atomic():
        for index, item_id in enumerate(ids):
            AgendaItem.objects.filter(
                pk=item_id, event=event, **scope,
            ).update(order=index)
    return JsonResponse({"ok": True})


@login_required
@require_POST
def agenda_set_template(request, pk):
    """Persist the agenda visual style choice."""
    event = _own_event_or_404(request.user, pk)
    key = (request.POST.get("template_key") or "").strip()
    if key not in AGENDA_TEMPLATE_KEYS:
        return JsonResponse({"ok": False, "error": "Unknown template."}, status=400)
    event.agenda_template_key = key
    event.save(update_fields=["agenda_template_key"])
    return JsonResponse({"ok": True, "key": key})


@login_required
@xframe_options_sameorigin
def agenda_preview(request, pk):
    """
    Tiny, self-contained agenda render for the editor's iframe.

    We use a dedicated view rather than embedding event_detail in an
    iframe because Django's XFrameOptionsMiddleware sends DENY by
    default — that's why Firefox shows the "Can't Open This Page" fox
    inside the iframe. Decorating this single view with
    @xframe_options_sameorigin overrides it for just this URL, and
    keeps the rest of the dashboard locked down.
    """
    event = _own_event_or_404(request.user, pk)
    return render(request, "attendance/agenda_preview.html", {"event": event})


# ── Agenda download (PDF / PNG via headless Chromium) ──────────

@login_required
@xframe_options_sameorigin
def agenda_print(request, pk):
    """
    Standalone agenda page for headless rendering.

    Loaded by services.render_agenda_pdf / render_agenda_png to capture
    real PDF / PNG files. Honours ?theme=dark|light so all 10 agenda
    templates can be flipped to a light palette without changing the
    template partials themselves — the page only overrides the --kk-*
    CSS variables.

    Decorated with @xframe_options_sameorigin so it can also be viewed
    in an iframe for debugging; harmless when Playwright is the caller.
    """
    event = _own_event_or_404(request.user, pk)
    theme = request.GET.get("theme", "dark")
    if theme not in ("dark", "light"):
        theme = "dark"
    return render(request, "attendance/agenda_print.html", {
        "event": event,
        "theme": theme,
    })


@login_required
def agenda_download(request, pk):
    """
    Stream a real downloadable file (PDF or PNG) of the agenda in the
    selected theme. No print dialog — Playwright drives a headless
    Chromium server-side that captures the rendered page.

    Query params:
        format=pdf|png     (default: pdf)
        theme=dark|light   (default: dark)

    Returns the bytes with Content-Disposition: attachment so the
    browser starts a download rather than rendering inline. Filename
    is slugified from the event title, e.g. "dev-summit-agenda-dark.pdf".

    If Playwright isn't installed we don't 500 — services raises a
    RuntimeError, we surface it as a flash message and bounce the user
    back to the event detail page. Mirrors how the reportlab-backed
    certificate flow handles its missing-dep case.
    """
    event = _own_event_or_404(request.user, pk)

    fmt = (request.GET.get("format") or "pdf").lower()
    if fmt not in ("pdf", "png"):
        return HttpResponseBadRequest("format must be 'pdf' or 'png'.")

    theme = (request.GET.get("theme") or "dark").lower()
    if theme not in ("dark", "light"):
        theme = "dark"

    try:
        if fmt == "pdf":
            data = services.render_agenda_pdf(request, event, theme=theme)
            content_type = "application/pdf"
        else:
            data = services.render_agenda_png(request, event, theme=theme)
            content_type = "image/png"
    except RuntimeError as e:
        messages.error(
            request,
            f"Could not generate agenda download: {e}",
        )
        return redirect("attendance:event_detail", pk=event.pk)

    slug = slugify(event.title) or f"event-{event.pk}"
    filename = f"{slug}-agenda-{theme}.{fmt}"

    response = HttpResponse(data, content_type=content_type)
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    response["Content-Length"] = str(len(data))
    return response


# ── Stats endpoint feeding the dashboard charts ─────────────────

@login_required
def event_stats_json(request, pk):
    """
    Series + breakdowns powering the dashboard charts.

    Everything time-based is bounded by the event's *data horizon* — the
    last calendar day that can legitimately hold a registration or a
    check-in (normally ends_at, extended if a row somehow landed later,
    and never beyond today). Once that day is in the past the numbers
    are frozen, so the series stops there instead of marching on to
    today with a tail of zeroes.

    Response shape matches what event_detail.html's chart JS consumes:
      - status_counts       : {pending, accepted, checked_in, declined, cancelled} (object, not array)
      - timeline            : [{date, registrations, check_ins}, ...]
      - timeline_start/end  : ISO dates actually plotted
      - timeline_truncated  : True if the window was clipped for size
      - is_final            : True once the horizon has passed — the
                              dashboard uses this to stop auto-refreshing
      - hourly_arrivals     : [{hour, count}, ...] across the event's days
      - hourly_days         : number of event days folded into the above
      - funnel              : {registered, accepted, checked_in} (object)
      - walk_in_split       : {pre_registered, walk_in} (object)
      - field_breakdowns    : [{label, type, buckets: [{value, count}, ...]}, ...]
      - capacity            : {capacity, filled, remaining} | null
      - headline            : {total, accepted, checked_in, pending} for the counters
      - generated_at        : ISO timestamp
    """
    event = _own_event_or_404(request.user, pk)
    # Pull once and reuse — the old code walked the queryset for the
    # counters and then issued extra COUNT queries for the same rows.
    reg_list = list(event.registrations.all())

    # ── Status counts as a flat object (chart JS keys into it directly) ──
    status_counter = Counter(r.status for r in reg_list)
    status_counts = {
        Registration.STATUS_PENDING:    status_counter.get(Registration.STATUS_PENDING, 0),
        Registration.STATUS_ACCEPTED:   status_counter.get(Registration.STATUS_ACCEPTED, 0),
        Registration.STATUS_CHECKED_IN: status_counter.get(Registration.STATUS_CHECKED_IN, 0),
        Registration.STATUS_DECLINED:   status_counter.get(Registration.STATUS_DECLINED, 0),
        Registration.STATUS_CANCELLED:  status_counter.get(Registration.STATUS_CANCELLED, 0),
    }

    # ── Registration timeline (per day) ────────────────────────
    # The window is anchored on the data horizon, NOT on "now". For a
    # live event the two are the same day; for an event that ended in
    # March, "last 30 days" means the 30 days up to the event's end —
    # otherwise the range simply lands past all the data and the chart
    # renders a flat, empty line.
    today = _local_date(timezone.now())
    first_day, end_day = _event_data_window(event, reg_list)
    # "Frozen" means no further rows can arrive: either the horizon is
    # behind us, or the organizer has explicitly marked the event ended
    # (which kills the QR and the check-in window today).
    is_final = end_day < today or event.status == AttendanceEvent.STATUS_ENDED

    range_param = (request.GET.get("range") or "30").strip()
    if range_param == "all":
        start_day = first_day
    else:
        try:
            days_back = max(1, min(int(range_param), 365))
        except (TypeError, ValueError):
            range_param = "30"
            days_back = 30
        # days_back INCLUDES the horizon day, so "7 d" plots 7 points.
        start_day = end_day - timedelta(days=days_back - 1)

    # Never start after the horizon, and never start before there is
    # anything to show.
    start_day = min(start_day, end_day)
    truncated = False
    if (end_day - start_day).days > MAX_TIMELINE_DAYS:
        start_day = end_day - timedelta(days=MAX_TIMELINE_DAYS)
        truncated = True

    regs_per_day = defaultdict(int)
    checkins_per_day = defaultdict(int)
    for r in reg_list:
        d = _local_date(r.registered_at)
        if start_day <= d <= end_day:
            regs_per_day[d] += 1
        if r.checked_in_at:
            cd = _local_date(r.checked_in_at)
            if start_day <= cd <= end_day:
                checkins_per_day[cd] += 1
    # Fill gaps so the chart line doesn't disappear on quiet days.
    timeline = []
    cursor = start_day
    while cursor <= end_day:
        timeline.append({
            "date":          cursor.isoformat(),
            "registrations": regs_per_day.get(cursor, 0),
            "check_ins":     checkins_per_day.get(cursor, 0),
        })
        cursor += timedelta(days=1)

    # ── Hourly check-in arrivals (across the event's days) ─────
    # Multi-day events used to lose every arrival after day one because
    # this only looked at starts_at.date(). We now fold every day of the
    # event window into one hour-of-day distribution and tell the client
    # how many days that was, so it can label the chart honestly.
    event_first = _local_date(event.starts_at)
    event_last = _local_date(event.ends_at)
    if event_last < event_first:
        event_last = event_first
    hourly = {h: 0 for h in range(24)}
    for r in reg_list:
        if not r.checked_in_at:
            continue
        cd = _local_date(r.checked_in_at)
        if event_first <= cd <= event_last:
            hourly[_local_time(r.checked_in_at).hour] += 1
    hourly_arrivals = [
        {"hour": f"{h:02d}:00", "count": hourly[h]} for h in range(24)
    ]
    hourly_days = (event_last - event_first).days + 1

    # ── Funnel (object keyed by stage name) ────────────────────
    total = len(reg_list)
    accepted = (
        status_counter.get(Registration.STATUS_ACCEPTED, 0)
        + status_counter.get(Registration.STATUS_CHECKED_IN, 0)
    )
    checked_in = status_counter.get(Registration.STATUS_CHECKED_IN, 0)
    funnel = {
        "registered": total,
        "accepted":   accepted,
        "checked_in": checked_in,
    }

    # ── Walk-in split (object) ─────────────────────────────────
    walk_in_count = sum(
        1 for r in reg_list
        if r.is_walk_in and r.status == Registration.STATUS_CHECKED_IN
    )
    pre_reg_in = max(checked_in - walk_in_count, 0)
    walk_in_split = {
        "pre_registered": pre_reg_in,
        "walk_in":        walk_in_count,
    }

    # ── Field breakdowns (buckets[{value, count}]) ────────────
    breakdowns = []
    choice_fields = event.fields.filter(
        field_type__in=[EventField.TYPE_SELECT, EventField.TYPE_MULTI, EventField.TYPE_CHECKBOX]
    )
    answer_qs = (
        RegistrationAnswer.objects
        .filter(field__in=choice_fields)
        .select_related("field")
    )
    by_field = defaultdict(Counter)
    for ans in answer_qs:
        # Multi-choice values are stored as "A, B, C" — split before counting.
        if ans.field.field_type == EventField.TYPE_MULTI:
            for piece in (p.strip() for p in (ans.value or "").split(",")):
                if piece:
                    by_field[ans.field_id][piece] += 1
        elif ans.field.field_type == EventField.TYPE_CHECKBOX:
            by_field[ans.field_id][
                "Yes" if ans.value in ("True", "true", "on", "1") else "No"
            ] += 1
        else:
            if ans.value:
                by_field[ans.field_id][ans.value] += 1
    for f in choice_fields:
        # `in` rather than by_field[f.pk] — the defaultdict would happily
        # create an empty Counter for every field we look at.
        if f.pk not in by_field or not by_field[f.pk]:
            continue
        # Top 8 values; anything else lumped into "Other".
        items = by_field[f.pk].most_common()
        top, rest = items[:8], items[8:]
        if rest:
            top.append(("Other", sum(c for _, c in rest)))
        breakdowns.append({
            "field_id": f.pk,
            "label":    f.label,
            "type":     f.field_type,
            "buckets":  [{"value": k, "count": v} for k, v in top],
        })

    # ── Capacity ──────────────────────────────────────────────
    capacity_info = None
    if event.capacity:
        filled = accepted
        capacity_info = {
            "capacity":  event.capacity,
            "filled":    filled,
            "remaining": max(event.capacity - filled, 0),
        }

    return JsonResponse({
        "ok":                 True,
        "generated_at":       timezone.now().isoformat(),
        "status_counts":      status_counts,
        "timeline":           timeline,
        "timeline_range":     range_param,
        "timeline_start":     start_day.isoformat(),
        "timeline_end":       end_day.isoformat(),
        "timeline_truncated": truncated,
        "is_final":           is_final,
        "event_status":       event.status,
        "ends_at":            event.ends_at.isoformat(),
        "hourly_arrivals":    hourly_arrivals,
        "hourly_days":        hourly_days,
        "funnel":             funnel,
        "walk_in_split":      walk_in_split,
        "field_breakdowns":   breakdowns,
        "capacity":           capacity_info,
        "headline": {
            "total":      total,
            "accepted":   accepted,
            "checked_in": checked_in,
            "pending":    status_counter.get(Registration.STATUS_PENDING, 0),
        },
    })

# ═══════════════════════════════════════════════════════════════
# ATTENDEE-SIDE (public, no auth)
# ═══════════════════════════════════════════════════════════════

def public_register(request, public_token):
    """
    Public form. Pre-event entry point — what the share link points to.
    Walk-ins reach this same view via the scan path with `?walk_in=1` set.
    """
    event = _public_event_or_404(public_token)
    if should_route_to_feedback(event):
        return redirect("attendance:public_feedback_by_token", public_token=public_token)
    if not event.is_qr_active():
        return render(request, "attendance/public_event_ended.html",
                      {"event": event}, status=410)

    walk_in = request.GET.get("walk_in") == "1"
    is_open = event.is_registration_open() or (walk_in and event.allow_walk_ins)
    if not is_open:
        return render(request, "attendance/public_registration_closed.html",
                      {"event": event}, status=403)

    if request.method == "POST":
        form = DynamicRegistrationForm(event, request.POST)
        if form.is_valid():
            reg = _persist_registration(event, form, walk_in=walk_in)
            services.send_registration_confirmation(reg, request=request)
            services.broadcast_new_registration(reg)
            return redirect("attendance:ticket", token=str(reg.token))
    else:
        form = DynamicRegistrationForm(event)

    return render(request, "attendance/public_register.html", {
        "event": event, "form": form, "walk_in": walk_in,
    })


def _persist_registration(event, form, *, walk_in=False):
    """Shared by both registration and walk-in paths."""
    name, email, phone = form.extract_identity()

    # If the same email already has a non-cancelled row, return it instead
    # of creating a duplicate. This handles the 'they registered twice' case
    # cleanly — the unique constraint would raise otherwise.
    if email:
        existing = event.registrations.filter(
            email=email,
        ).exclude(status=Registration.STATUS_CANCELLED).first()
        if existing:
            # Update answers but keep the original token/status.
            _save_answers(existing, form)
            return existing

    initial_status = (
        Registration.STATUS_CHECKED_IN if walk_in
        else (Registration.STATUS_ACCEPTED
              if event.registration_mode == AttendanceEvent.REG_MODE_AUTO
              else Registration.STATUS_PENDING)
    )

    reg = Registration.objects.create(
        event=event,
        full_name=name, email=email, phone=phone,
        status=initial_status,
        is_walk_in=walk_in,
        accepted_at=timezone.now() if initial_status != Registration.STATUS_PENDING else None,
        checked_in_at=timezone.now() if initial_status == Registration.STATUS_CHECKED_IN else None,
    )
    _save_answers(reg, form)
    if walk_in:
        services.broadcast_check_in(reg)
    return reg


def _save_answers(reg, form):
    """Persist the dynamic answers, replacing any existing ones."""
    RegistrationAnswer.objects.filter(registration=reg).delete()
    rows = []
    for field in reg.event.fields.all():
        value = form.cleaned_data.get(field.html_input_name())
        if value is None:
            continue
        if isinstance(value, (list, tuple)):
            value = ", ".join(str(v) for v in value)
        rows.append(RegistrationAnswer(
            registration=reg, field=field, value=str(value),
        ))
    RegistrationAnswer.objects.bulk_create(rows)


def ticket(request, token):
    """Attendee's personal page — shows their QR + agenda + announcements."""
    reg = _registration_or_404(token)
    # If the event has ended and the organizer has activated the feedback
    # survey, the personal ticket QR should land on the survey instead.
    # We redirect rather than render inline so the ticket page itself
    # stays focused on its current responsibilities.
    if should_route_to_feedback(reg.event):
        return redirect("attendance:public_feedback_by_ticket", token=str(reg.token))
    return render(request, "attendance/ticket.html", {
        "registration": reg, "event": reg.event,
        # 5 newest announcements rendered server-side so a reload still
        # shows recent organizer messages. The WS subscription in the
        # page script handles anything that lands after the page opens.
        "recent_announcements": reg.event.announcements.all()[:5],
    })


@require_GET
def ticket_qr(request, token):
    """PNG QR encoding the attendee's check-in URL."""
    reg = _registration_or_404(token)
    target = request.build_absolute_uri(
        reverse("attendance:attendee_check_in", kwargs={"token": str(reg.token)})
    )
    return HttpResponse(services.make_qr_png(target), content_type="image/png")


@require_GET
def public_qr(request, public_token):
    """
    The event-level QR — printed/projected at the venue.

    Three render sizes via ?size= query string:
      - small  (box_size=6, for an inline preview on the dashboard)
      - normal (box_size=12, the default)
      - large  (box_size=20, for the print poster)
    `?download=1` forces an attachment header so the dashboard's
    "Download PNG" button saves rather than displays.
    """
    event = _public_event_or_404(public_token)
    size_map = {"small": 6, "normal": 12, "large": 20}
    box_size = size_map.get(request.GET.get("size", "normal"), 12)
    target = request.build_absolute_uri(
        reverse("attendance:public_check_in", kwargs={"public_token": public_token})
    )
    png_bytes = services.make_qr_png(target, box_size=box_size)
    response = HttpResponse(png_bytes, content_type="image/png")
    if request.GET.get("download"):
        safe_title = "".join(
            ch if ch.isalnum() or ch in "-_" else "-"
            for ch in event.title
        )[:60] or "event"
        response["Content-Disposition"] = (
            f'attachment; filename="{safe_title}-qr.png"'
        )
    return response


@login_required
def public_qr_poster(request, pk):
    """
    A4-print-friendly poster wrapping the event QR — meant to be taped to
    the door of the venue or printed in advance. Renders a clean HTML page
    with @media print styles so 'Save as PDF' from the browser produces
    a perfectly composed sheet.

    Lives on the organiser side (login_required + own event) so a random
    public visitor can't generate posters for someone else's event.
    """
    event = _own_event_or_404(request.user, pk)
    register_url = request.build_absolute_uri(event.get_public_register_url())
    check_in_url = request.build_absolute_uri(
        reverse("attendance:public_check_in", kwargs={"public_token": event.public_token})
    )
    return render(request, "attendance/qr_poster.html", {
        "event": event,
        "register_url": register_url,
        "check_in_url": check_in_url,
    })


def public_check_in(request, public_token):
    """
    Where the event-level QR lands.

    The flow:
      - GET shows a small form with two options:
          1) 'I'm registered' → email/phone field → tap → checked_in
          2) 'I haven't registered yet' → walk-in form (if allowed)
      - POST with identifier → look up registration → geofence-check →
        flip status.
    """
    event = _public_event_or_404(public_token)
    if should_route_to_feedback(event):
        return redirect("attendance:public_feedback_by_token", public_token=public_token)
    if not event.is_qr_active():
        return render(request, "attendance/public_event_ended.html",
                      {"event": event}, status=410)
    if not event.is_check_in_open():
        return render(request, "attendance/public_check_in_closed.html",
                      {"event": event}, status=403)

    matched = None
    error = None
    if request.method == "POST":
        form = QuickCheckInForm(event, request.POST)
        if form.is_valid():
            ident = form.cleaned_data["identifier"]
            matched = _find_registration(event, ident)
            if matched is None:
                error = "We couldn't find a registration for that email or phone. " \
                        "Tap 'I haven't registered' below if you'd like to register now."
            elif matched.status in (Registration.STATUS_DECLINED,
                                    Registration.STATUS_CANCELLED):
                error = "Your registration was withdrawn. Please see the organizer."
            elif matched.status == Registration.STATUS_PENDING:
                error = "Your registration is still pending review by the organizer."
            else:
                # Geofence gate: if enabled, demand a coord pair and
                # verify before checking in.
                if event.has_geofence():
                    lat, lng = _parse_coords(request)
                    if lat is None:
                        return render(request, "attendance/public_geofence_required.html", {
                            "event": event,
                            "intent": "self_checkin",
                            "identifier": ident,
                        })
                    if not event.is_within_geofence(lat, lng):
                        distance = event.distance_from_venue_m(lat, lng)
                        return render(request, "attendance/public_geofence_required.html", {
                            "event": event,
                            "intent": "self_checkin",
                            "identifier": ident,
                            "distance_m": int(distance) if distance else None,
                            "out_of_range": True,
                        }, status=403)

                matched, created, reason = matched.record_daily_check_in(
                    device_token=_device_token(request),
                    method=CheckIn.METHOD_SELF,
                )
                if created:
                    services.broadcast_check_in(matched)
                else:
                    # Already checked in today (repeat, or reused device)
                    # — same gentle message, then on to their ticket.
                    messages.info(request,
                                  "You're already checked in for today.")
                return redirect("attendance:ticket",
                                token=str(matched.token))
    else:
        form = QuickCheckInForm(event)

    return render(request, "attendance/public_check_in.html", {
        "event": event, "form": form, "error": error,
        "can_walk_in": event.allow_walk_ins and event.is_registration_open(),
    })


def attendee_check_in(request, token):
    """
    Where an attendee's *personal* QR lands. Single-tap presence:
    look up by token, geofence-check if configured, flip to checked_in.

    Geofence enforcement is the same as the event-level QR path: if the
    event requires location, we render a "share your location" page on
    first hit (no lat/lng in URL), and only after we have coords and
    confirm they're inside the radius do we mark them checked in.
    """
    reg = _registration_or_404(token)
    event = reg.event

    if not event.is_check_in_open():
        return render(request, "attendance/public_check_in_closed.html",
                      {"event": event}, status=403)
    if reg.status == Registration.STATUS_PENDING:
        messages.info(request, "Your registration is still pending review.")
        return redirect("attendance:ticket", token=str(reg.token))
    if reg.status in (Registration.STATUS_DECLINED,
                      Registration.STATUS_CANCELLED):
        # Withdrawn registrations can't check in at all.
        return redirect("attendance:ticket", token=str(reg.token))
    # Note: STATUS_CHECKED_IN is NOT bounced here any more. A multi-day
    # event means someone checked in yesterday is still eligible today;
    # record_daily_check_in() handles same-day duplicate suppression.

    # Geofence gate.
    if event.has_geofence():
        lat, lng = _parse_coords(request)
        if lat is None:
            # First hit — no coords yet. Ask the browser for permission.
            return render(request, "attendance/public_geofence_required.html", {
                "event": event,
                "intent": "ticket_checkin",
                "registration": reg,
            })
        if not event.is_within_geofence(lat, lng):
            distance = event.distance_from_venue_m(lat, lng)
            return render(request, "attendance/public_geofence_required.html", {
                "event": event,
                "intent": "ticket_checkin",
                "registration": reg,
                "distance_m": int(distance) if distance else None,
                "out_of_range": True,
            }, status=403)

    check_in, created, reason = reg.record_daily_check_in(
        device_token=_device_token(request),
        method=CheckIn.METHOD_TICKET,
    )
    if created:
        services.broadcast_check_in(reg)
        messages.success(request, "You're checked in. Enjoy the event!")
    else:
        # Both a repeat scan and a reused device land here — same gentle
        # message, no fuss.
        messages.info(request, "You're already checked in for today.")
    return redirect("attendance:ticket", token=str(reg.token))


def _find_registration(event, identifier):
    """Look up by email or phone. Returns the first non-cancelled match."""
    qs = event.registrations.exclude(status=Registration.STATUS_CANCELLED)
    if "@" in identifier:
        return qs.filter(email__iexact=identifier).first()
    # Phone — strip whitespace, compare trailing digits to handle '+220 …' variants.
    digits = "".join(ch for ch in identifier if ch.isdigit())
    if not digits:
        return None
    for reg in qs.filter(phone__icontains=digits[-7:]):  # last 7 digits is usually enough
        return reg
    return None


@login_required
@require_POST
def event_delete(request, pk):
    """Permanently delete an attendance event.

    Cascades through Registrations, Fields, Certificates etc. via FK rules
    on the models. POST-only; the dashboard's trash button posts a tiny form
    with a `next` param so the user lands back where they started.
    """
    event = get_object_or_404(AttendanceEvent, pk=pk, owner=request.user)
    title = event.title
    event.delete()
    messages.success(request, f"Deleted “{title}”.")

    nxt = request.POST.get("next") or ""
    if nxt.startswith("/"):  # accept relative paths only — guard open redirects
        return redirect(nxt)
    return redirect("attendance:event_list")

# ─────────────────────────────────────────────────────────────────
# Duplicate an attendance event — deep copy of the event row, every
# registration form field, and every agenda item. Public identifiers
# (token, code) are regenerated and status is forced to draft.
# Registrations and announcements belong to the original event only
# and are NOT copied.
# ─────────────────────────────────────────────────────────────────

def _next_event_copy_title(owner, base_title):
    """
    Return a title that doesn't collide with this organizer's existing
    events. "X" → "Copy of X", then "Copy of X (2)", "(3)", … up to
    99 before falling back to a plain "Copy of X" — the user can
    rename freely from the edit page.
    """
    candidate = f"Copy of {base_title}"
    if not AttendanceEvent.objects.filter(owner=owner, title=candidate).exists():
        return candidate
    for n in range(2, 100):
        attempt = f"Copy of {base_title} ({n})"
        if not AttendanceEvent.objects.filter(owner=owner, title=attempt).exists():
            return attempt
    return candidate


@login_required
@require_POST
def event_duplicate(request, pk):
    """
    Deep-copy an attendance event so the organizer can reuse the format.

    Copied:
      - The AttendanceEvent row: title, description, agenda text, cover
        image (by reference), location, online URL, all time fields,
        timezone, capacity, registration mode + close time, walk-in
        toggle, full geofence config, venue FK, every certificate
        config field (template key, logo, logo positioning).
      - Every EventField (the registration form's questions).
      - Every AgendaItem (each agenda row).

    NOT copied (intentional — those are per-instance, not template):
      - public_token / code: regenerated on save() so the new event has
        its own unique public URL and QR. If they weren't reset, a
        single public URL would point at two events and the QR scans
        would collide.
      - status: forced to "draft" so a duplicate of a live event
        doesn't silently open a second registration page on the same
        template.
      - Registration rows and EventAnnouncement rows: session history
        attached to the original event only. The duplicate starts
        clean.

    POST-only — never reachable as GET so accidental link prefetch
    can't create copies.
    """
    original = _own_event_or_404(request.user, pk)

    with transaction.atomic():
        # 1) Clone the AttendanceEvent row itself. We refetch by pk so
        #    the Python instance we mutate isn't the same object the
        #    rest of the request might hold a reference to.
        copy = AttendanceEvent.objects.get(pk=original.pk)
        copy.pk = None
        copy.title = _next_event_copy_title(request.user, original.title)

        # Server-generated identifiers must be cleared so the model's
        # default callables run again on save(). Keeping the old values
        # would violate the unique constraints on public_token / code.
        copy.public_token = ""
        copy.code = ""

        # Force draft status. AttendanceEvent has STATUS_DRAFT defined
        # but using the raw string keeps this resilient if the constant
        # ever moves; both compile to "draft".
        copy.status = "draft"

        # auto_now_add / auto_now fields are handled by save().
        copy.save()

        # 2) Clone every EventField (the registration form's questions).
        #    EventField rows carry preset_key, label, options, required,
        #    order — all pure template data, safe to copy verbatim.
        for f in original.fields.all():
            f.pk = None
            f.event = copy
            f.save()

        # 3) Clone every AgendaItem. Same deal — pure template content.
        for item in original.agenda_items.all():
            item.pk = None
            item.event = copy
            item.save()

    messages.success(
        request,
        f"Duplicated “{original.title}” → “{copy.title}”. "
        f"It's saved as a draft — open it to set new dates and publish.",
    )
    nxt = request.POST.get("next") or ""
    if nxt.startswith("/"):
        return redirect(nxt)
    return redirect("attendance:event_list")


@login_required
@require_POST
def agenda_day_add(request, pk):
    """Create a new day. POSTs whatever AgendaDayForm expects."""
    event = _own_event_or_404(request.user, pk)

    form = AgendaDayForm(request.POST)
    if not form.is_valid():
        return JsonResponse({
            "ok": False,
            "error": "; ".join(f"{k}: {v[0]}" for k, v in form.errors.items()),
        }, status=400)

    day = form.save(commit=False)
    day.event = event
    day.order = (event.agenda_days.aggregate(Max("order"))["order__max"] or 0) + 1
    day.save()
    return JsonResponse({
        "ok": True,
        "day": {
            "id": day.pk,
            "date": day.date.isoformat(),
            "label": day.label,
            "order": day.order,
        },
    })


@login_required
@require_POST
def agenda_day_edit(request, pk, day_id):
    event = _own_event_or_404(request.user, pk)
    day = get_object_or_404(AgendaDay, pk=day_id, event=event)
    form = AgendaDayForm(request.POST, instance=day)
    if not form.is_valid():
        return JsonResponse({
            "ok": False,
            "error": "; ".join(f"{k}: {v[0]}" for k, v in form.errors.items()),
        }, status=400)
    form.save()
    return JsonResponse({
        "ok": True,
        "day": {
            "id": day.pk,
            "date": day.date.isoformat(),
            "label": day.label,
            "order": day.order,
        },
    })


@login_required
@require_POST
def agenda_day_delete(request, pk, day_id):
    """Delete a day. Cascades to delete all its sessions.

    The editor UI MUST confirm with the organiser before calling this
    — deleting a day silently removes every item inside it.
    """
    event = _own_event_or_404(request.user, pk)
    day = get_object_or_404(AgendaDay, pk=day_id, event=event)
    day.delete()
    return JsonResponse({"ok": True, "deleted_id": day_id})


@login_required
@require_POST
def agenda_day_reorder(request, pk):
    """Save drag-order for days. Body: {"order": [3, 1, 2]}."""
    event = _own_event_or_404(request.user, pk)
    try:
        payload = json.loads(request.body or "{}")
        ids = payload.get("order") or []
    except ValueError:
        return HttpResponseBadRequest("Bad JSON.")
    with transaction.atomic():
        for index, day_id in enumerate(ids):
            AgendaDay.objects.filter(pk=day_id, event=event).update(order=index)
    return JsonResponse({"ok": True})