"""
Public agenda links — views.

ORGANIZER (login, event owner only)
  agenda_share            the "Share agenda" page: list, create, manage
  agenda_share_create     POST  new link (label, auto-stop)
  agenda_share_toggle     POST  stop / resume one link
  agenda_share_delete     POST  delete one link (its URL stops for good)
  agenda_share_stop_all   POST  stop every live link at once
  agenda_share_qr         PNG   QR code for one link

PUBLIC (no login, nothing asked of the visitor)
  public_agenda           the agenda page
  public_agenda_status    tiny JSON the open page polls: still shared?
                          agenda changed since I loaded?
  public_agenda_ics       every session as a calendar file

A stopped, expired or unknown link gets a neutral page that names no
event, so a link that leaked and was stopped reveals nothing further.
"""

import hashlib
import json
from datetime import datetime, timedelta, timezone as dt_timezone
from urllib.parse import quote
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.db.models import F
from django.http import HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.views.decorators.http import require_GET, require_POST

from . import services
from .agenda_share_models import AgendaShareLink
from .models import AttendanceEvent


# ─────────────────────────── helpers ───────────────────────────

def _own_event_or_404(user, pk):
    return get_object_or_404(AttendanceEvent, pk=pk, owner=user)


def _event_tz(event):
    """The event's timezone; agenda times are wall-clock times there."""
    try:
        return ZoneInfo(event.timezone_name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def agenda_sessions(event):
    """
    The agenda as a flat, ordered list of sessions with real start/end
    instants (aware datetimes, in UTC), for the now/next strip, the
    calendar file and the change fingerprint.

    Sessions without an end time end when the next one that day starts,
    or after 30 minutes.
    """
    tz = _event_tz(event)
    fallback_date = event.starts_at.astimezone(tz).date()
    items = list(
        event.agenda_items.select_related("day")
        .order_by("day__order", "day__date", "order", "start_time")
    )
    sessions = []
    for item in items:
        day = item.day.date if item.day else fallback_date
        start = datetime.combine(day, item.start_time, tzinfo=tz)
        end = (datetime.combine(day, item.end_time, tzinfo=tz)
               if item.end_time and item.end_time > item.start_time else None)
        sessions.append({
            "id": item.pk,
            "title": item.title,
            "speaker": item.speaker,
            "track": item.track,
            "description": item.description,
            "day_label": (item.day.label if item.day else ""),
            "start": start,
            "end": end,
        })
    # Fill missing ends: next session's start on the same day, else +30 min.
    by_start = sorted(sessions, key=lambda s: s["start"])
    for i, s in enumerate(by_start):
        if s["end"] is None:
            nxt = next((n for n in by_start[i + 1:]
                        if n["start"] > s["start"] and n["start"].date() == s["start"].date()), None)
            s["end"] = nxt["start"] if nxt else s["start"] + timedelta(minutes=30)
    for s in sessions:
        s["start"] = s["start"].astimezone(dt_timezone.utc)
        s["end"] = s["end"].astimezone(dt_timezone.utc)
    return sessions


def agenda_fingerprint(event):
    """Changes whenever anything a viewer would see on the agenda changes."""
    days = list(event.agenda_days.values_list("id", "date", "label", "order"))
    items = list(event.agenda_items.values_list(
        "id", "day_id", "order", "start_time", "end_time", "title",
        "description", "speaker", "track", "status", "accent_colour"))
    blob = json.dumps([event.title, event.agenda_template_key, event.agenda,
                       days, items], default=str, sort_keys=True)
    return hashlib.sha1(blob.encode()).hexdigest()[:16]


def _link_for_public(token):
    """(link, event) for a token, or (None, None) for unknown tokens."""
    link = (AgendaShareLink.objects.select_related("event")
            .filter(token=str(token)[:40]).first())
    return (link, link.event) if link else (None, None)


def _off_page(request, link=None, status=410):
    """The neutral 'this link is off' page — no event details at all."""
    reason = link.state() if link else "unknown"
    return render(request, "attendance/public_agenda_off.html",
                  {"reason": reason}, status=status if link else 404)


# ═══════════════════════════ ORGANIZER ═══════════════════════════

@login_required
def agenda_share(request, pk):
    event = _own_event_or_404(request.user, pk)
    links = list(event.agenda_share_links.all())
    now = timezone.now()
    for link in links:
        link.current_state = link.state(now)
        link.viewed_ago = _ago(link.last_viewed_at, now)
        link.stopped_ago = _ago(link.stopped_at, now)
        link.absolute_url = request.build_absolute_uri(link.get_public_url())
        link.whatsapp_url = "https://wa.me/?text=" + quote(
            f"{event.title} — agenda: {link.absolute_url}")
    # Live links first (the ones you act on), newest first within each group.
    links.sort(key=lambda l: l.current_state != AgendaShareLink.STATE_LIVE)
    return render(request, "attendance/agenda_share.html", {
        "event": event,
        "links": links,
        "live_count": sum(1 for l in links if l.current_state == AgendaShareLink.STATE_LIVE),
        "agenda_is_empty": not (event.agenda_items.exists() or event.agenda.strip()),
        "auto_stop_at": event.ends_at + timedelta(hours=24),
    })


@login_required
@require_POST
def agenda_share_create(request, pk):
    event = _own_event_or_404(request.user, pk)
    label = (request.POST.get("label") or "").strip()[:80]
    link = AgendaShareLink.objects.create(
        event=event,
        label=label,
        stop_after_event=request.POST.get("stop_after_event") == "on",
        created_by=request.user,
    )
    messages.success(request, f"New link ready{' for ' + label if label else ''}. Copy it and send it anywhere.")
    return redirect(f"{_share_page(event)}#link-{link.pk}")


@login_required
@require_POST
def agenda_share_toggle(request, pk, link_id):
    event = _own_event_or_404(request.user, pk)
    link = get_object_or_404(AgendaShareLink, pk=link_id, event=event)
    name = link.label or "The link"
    if request.POST.get("action") == "stop":
        link.stop()
        messages.info(request, f"{name} is stopped. Anyone opening it now sees that it’s turned off.")
    else:
        link.resume()
        messages.success(request, f"{name} is shared again, on the same address.")
    return redirect(f"{_share_page(event)}#link-{link.pk}")


@login_required
@require_POST
def agenda_share_delete(request, pk, link_id):
    event = _own_event_or_404(request.user, pk)
    link = get_object_or_404(AgendaShareLink, pk=link_id, event=event)
    name = link.label or "The link"
    link.delete()
    messages.info(request, f"{name} is deleted. Its address will never work again.")
    return redirect(_share_page(event))


@login_required
@require_POST
def agenda_share_stop_all(request, pk):
    event = _own_event_or_404(request.user, pk)
    count = event.agenda_share_links.filter(is_active=True).update(
        is_active=False, stopped_at=timezone.now())
    messages.info(request, f"Stopped {count} link{'' if count == 1 else 's'}. "
                           "Nobody can open the agenda from them now.")
    return redirect(_share_page(event))


@login_required
@require_GET
def agenda_share_qr(request, pk, link_id):
    event = _own_event_or_404(request.user, pk)
    link = get_object_or_404(AgendaShareLink, pk=link_id, event=event)
    png = services.make_qr_png(request.build_absolute_uri(link.get_public_url()), box_size=12)
    response = HttpResponse(png, content_type="image/png")
    if request.GET.get("download"):
        name = "".join(c if c.isalnum() or c in "-_" else "-" for c in (link.label or event.title))[:50]
        response["Content-Disposition"] = f'attachment; filename="agenda-{name or "link"}-qr.png"'
    return response


def _ago(when, now):
    """'just now', '5 minutes ago', '2 days ago' — or '' for None."""
    if not when:
        return ""
    from django.utils.timesince import timesince
    if (now - when).total_seconds() < 60:
        return "just now"
    return f"{timesince(when, now).split(',')[0]} ago"


def _share_page(event):
    from django.urls import reverse
    return reverse("attendance:agenda_share", kwargs={"pk": event.pk})


# ═══════════════════════════ PUBLIC ═══════════════════════════

@require_GET
def public_agenda(request, token):
    link, event = _link_for_public(token)
    if not link or not link.is_live():
        return _off_page(request, link)

    # Count real visitors, not the organizer checking their own link.
    if not (request.user.is_authenticated and request.user.pk == event.owner_id):
        AgendaShareLink.objects.filter(pk=link.pk).update(
            view_count=F("view_count") + 1, last_viewed_at=timezone.now())

    sessions = agenda_sessions(event)
    response = render(request, "attendance/public_agenda.html", {
        "event": event,
        "link": link,
        "has_agenda": bool(sessions) or bool(event.agenda.strip()),
        "sessions_json": [
            {"title": s["title"], "speaker": s["speaker"], "track": s["track"],
             "day": s["day_label"], "start": s["start"].isoformat(), "end": s["end"].isoformat()}
            for s in sessions
        ],
        "fingerprint": agenda_fingerprint(event),
    })
    # Shared links get passed around; keep them out of search engines and
    # don't leak the token to other sites through the Referer header.
    response["X-Robots-Tag"] = "noindex, nofollow"
    response["Referrer-Policy"] = "no-referrer"
    response["Cache-Control"] = "no-store"
    return response


@require_GET
def public_agenda_status(request, token):
    link, event = _link_for_public(token)
    if not link or not link.is_live():
        return JsonResponse({"live": False}, headers={"Cache-Control": "no-store"})
    return JsonResponse({"live": True, "fingerprint": agenda_fingerprint(event)},
                        headers={"Cache-Control": "no-store"})


@require_GET
def public_agenda_ics(request, token):
    link, event = _link_for_public(token)
    if not link or not link.is_live():
        return _off_page(request, link)

    page_url = request.build_absolute_uri(link.get_public_url())
    stamp = _ics_time(timezone.now())
    location = event.location or ""
    lines = [
        "BEGIN:VCALENDAR", "VERSION:2.0",
        "PRODID:-//Knock-Knock//Agenda//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
        "X-WR-CALNAME:" + _ics_text(event.title),
    ]
    for s in agenda_sessions(event):
        description = "\n".join(x for x in [
            s["speaker"] and f"Speaker: {s['speaker']}",
            s["track"] and f"Where: {s['track']}",
            s["description"],
            f"Full agenda: {page_url}",
        ] if x)
        lines += [
            "BEGIN:VEVENT",
            f"UID:agenda-{event.pk}-{s['id']}@knock-knock",
            "DTSTAMP:" + stamp,
            "DTSTART:" + _ics_time(s["start"]),
            "DTEND:" + _ics_time(s["end"]),
            "SUMMARY:" + _ics_text(s["title"]),
            "DESCRIPTION:" + _ics_text(description),
        ]
        if location:
            lines.append("LOCATION:" + _ics_text(location))
        if event.has_venue_pin():
            lines.append(f"GEO:{event.geofence_lat:.6f};{event.geofence_lng:.6f}")
        lines += ["URL:" + page_url, "END:VEVENT"]
    lines.append("END:VCALENDAR")

    body = "\r\n".join(_ics_fold(line) for line in lines) + "\r\n"
    filename = "".join(c if c.isalnum() or c in "-_" else "-" for c in event.title)[:50] or "agenda"
    response = HttpResponse(body, content_type="text/calendar; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="{filename}-agenda.ics"'
    response["X-Robots-Tag"] = "noindex, nofollow"
    return response


def _ics_time(dt):
    return dt.astimezone(dt_timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _ics_text(value):
    return (str(value).replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
            .replace("\r\n", "\\n").replace("\n", "\\n"))


def _ics_fold(line):
    """RFC 5545: lines over 75 octets continue on lines starting with a space."""
    raw = line.encode("utf-8")
    if len(raw) <= 75:
        return line
    parts, limit = [], 75
    while raw:
        cut = min(limit, len(raw))
        while cut < len(raw) and (raw[cut] & 0xC0) == 0x80:   # don't split a UTF-8 character
            cut -= 1
        parts.append(raw[:cut].decode("utf-8"))
        raw = raw[cut:]
        limit = 74   # continuation lines carry a leading space
    return "\r\n ".join(parts)
