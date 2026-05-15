"""
Views.

Three groups, separated by who they're for:

  ORGANIZER-SIDE  (login_required, owner-only)
    list, create, edit, detail (the live dashboard), form_builder,
    registrations table, approve/decline, manual check-in, announcements,
    export, certificates, status transitions.

  ATTENDEE-SIDE  (public)
    public_register  — fills the form
    public_qr        — the projected/printed QR for the venue
    ticket           — the attendee's personal page with their personal QR
    public_check_in  — what the event-level QR ultimately routes to

  JSON ENDPOINTS  (used by the drag-and-drop form builder)
    add_preset_field, add_custom_field, reorder_fields,
    edit_field, delete_field
"""

import csv
import json

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.db import transaction
from django.http import (
    Http404, HttpResponse, HttpResponseBadRequest, JsonResponse,
)
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.http import require_GET, require_POST

from .forms import (
    AnnouncementForm, DynamicRegistrationForm, EventFieldForm,
    EventForm, QuickCheckInForm,
)
from .models import (
    AttendanceEvent, Certificate, EventField, PRESET_FIELDS, Registration,
    RegistrationAnswer,
)
from . import services


# ─────────────────── helpers ───────────────────

def _own_event_or_404(user, pk):
    return get_object_or_404(AttendanceEvent, pk=pk, owner=user)


def _public_event_or_404(token):
    return get_object_or_404(AttendanceEvent, public_token=token)


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
        form = EventForm(request.POST, request.FILES)
        if form.is_valid():
            event = form.save(commit=False)
            event.owner = request.user
            event.save()
            messages.success(request, f"Event '{event.title}' created. Now build the registration form.")
            return redirect("attendance:form_builder", pk=event.pk)
    else:
        form = EventForm()
    return render(request, "attendance/event_form.html", {"form": form, "is_new": True})


@login_required
def event_edit(request, pk):
    event = _own_event_or_404(request.user, pk)
    if request.method == "POST":
        form = EventForm(request.POST, request.FILES, instance=event)
        if form.is_valid():
            form.save()
            messages.success(request, "Event updated.")
            return redirect("attendance:event_detail", pk=event.pk)
    else:
        form = EventForm(instance=event)
    return render(request, "attendance/event_form.html", {
        "form": form, "event": event, "is_new": False,
    })


@login_required
def event_detail(request, pk):
    """The organizer's live dashboard for one event."""
    event = _own_event_or_404(request.user, pk)
    regs = event.registrations.select_related("user").order_by("-registered_at")

    # Build the QR URL that gets projected/printed at the venue.
    public_qr_target = request.build_absolute_uri(
        reverse("attendance:public_check_in", kwargs={"public_token": event.public_token})
    )

    return render(request, "attendance/event_detail.html", {
        "event": event,
        "registrations": regs,
        "registrations_pending": [r for r in regs if r.status == Registration.STATUS_PENDING],
        "registrations_accepted": [r for r in regs if r.status in (
            Registration.STATUS_ACCEPTED, Registration.STATUS_CHECKED_IN,
        )],
        "checked_in_count": event.checked_in_count(),
        "accepted_count": event.accepted_count(),
        "pending_count": event.pending_count(),
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

    next_order = (event.fields.aggregate(m=__import__("django").db.models.Max("order"))["m"] or 0) + 1
    field = EventField.objects.create(
        event=event,
        preset_key=preset["key"],
        label=preset["label"],
        field_type=preset["field_type"],
        required=preset.get("required", False),
        options="\n".join(preset.get("options", [])),
        order=next_order,
    )
    return JsonResponse({"ok": True, "field": _field_to_json(field)})


@login_required
@require_POST
def field_add_custom(request, pk):
    """Add a fresh custom field (the 'customize' button)."""
    event = _own_event_or_404(request.user, pk)
    next_order = (event.fields.aggregate(m=__import__("django").db.models.Max("order"))["m"] or 0) + 1
    field = EventField.objects.create(
        event=event,
        label=request.POST.get("label", "Untitled question"),
        field_type=request.POST.get("field_type", EventField.TYPE_TEXT),
        required=request.POST.get("required") == "on",
        order=next_order,
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
    event = _own_event_or_404(request.user, pk)
    EventField.objects.filter(pk=field_id, event=event).delete()
    return JsonResponse({"ok": True})


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
def certificate_download(request, pk, reg_id):
    event = _own_event_or_404(request.user, pk)
    reg = get_object_or_404(Registration, pk=reg_id, event=event)
    if reg.status != Registration.STATUS_CHECKED_IN:
        messages.error(request, "Certificates are only available to checked-in attendees.")
        return redirect("attendance:event_detail", pk=event.pk)
    cert = services.generate_certificate(reg)
    if not cert.pdf_file:
        messages.warning(request, f"Certificate issued (serial {cert.serial}) — install reportlab to render PDFs.")
        return redirect("attendance:event_detail", pk=event.pk)
    return redirect(cert.pdf_file.url)


@login_required
@require_POST
def certificates_bulk(request, pk):
    """Generate certificates for everyone checked in."""
    event = _own_event_or_404(request.user, pk)
    if not event.generate_certificates:
        messages.error(request, "Enable certificates on the event first.")
        return redirect("attendance:event_detail", pk=event.pk)
    count = 0
    for reg in event.registrations.filter(status=Registration.STATUS_CHECKED_IN):
        try:
            services.generate_certificate(reg)
            count += 1
        except Exception:
            continue
    messages.success(request, f"Generated {count} certificate(s).")
    return redirect("attendance:event_detail", pk=event.pk)


# ═══════════════════════════════════════════════════════════════
# ATTENDEE-SIDE (public, no auth)
# ═══════════════════════════════════════════════════════════════

def public_register(request, public_token):
    """
    Public form. Pre-event entry point — what the share link points to.
    Walk-ins reach this same view via the scan path with `?walk_in=1` set.
    """
    event = _public_event_or_404(public_token)
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
    reg = get_object_or_404(Registration, token=token)
    return render(request, "attendance/ticket.html", {
        "registration": reg, "event": reg.event,
    })


@require_GET
def ticket_qr(request, token):
    """PNG QR encoding the attendee's check-in URL."""
    reg = get_object_or_404(Registration, token=token)
    target = request.build_absolute_uri(
        reverse("attendance:attendee_check_in", kwargs={"token": str(reg.token)})
    )
    return HttpResponse(services.make_qr_png(target), content_type="image/png")


@require_GET
def public_qr(request, public_token):
    """The event-level QR — printed/projected at the venue."""
    event = _public_event_or_404(public_token)
    target = request.build_absolute_uri(
        reverse("attendance:public_check_in", kwargs={"public_token": public_token})
    )
    return HttpResponse(services.make_qr_png(target, box_size=12),
                        content_type="image/png")


def public_check_in(request, public_token):
    """
    Where the event-level QR lands.

    The flow:
      - GET shows a small form with two options:
          1) 'I'm registered' → email/phone field → tap → checked_in
          2) 'I haven't registered yet' → walk-in form (if allowed)
      - POST with identifier → look up registration → flip status.
    """
    event = _public_event_or_404(public_token)
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
                matched.mark_checked_in()
                services.broadcast_check_in(matched)
                return redirect("attendance:ticket", token=str(matched.token))
    else:
        form = QuickCheckInForm(event)

    return render(request, "attendance/public_check_in.html", {
        "event": event, "form": form, "error": error,
        "can_walk_in": event.allow_walk_ins and event.is_registration_open(),
    })


def attendee_check_in(request, token):
    """
    Where an attendee's *personal* QR lands. Single-tap presence:
    look up by token, flip to checked_in if allowed.
    """
    reg = get_object_or_404(Registration, token=token)
    if not reg.event.is_check_in_open():
        return render(request, "attendance/public_check_in_closed.html",
                      {"event": reg.event}, status=403)
    if reg.status == Registration.STATUS_PENDING:
        messages.info(request, "Your registration is still pending review.")
        return redirect("attendance:ticket", token=str(reg.token))
    if reg.status == Registration.STATUS_ACCEPTED:
        reg.mark_checked_in()
        services.broadcast_check_in(reg)
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
