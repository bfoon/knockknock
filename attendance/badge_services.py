"""
Badge helpers — builds the per-attendee data the JS renderer needs, and
renders the print sheet to PDF with headless Chromium.

Nothing here draws a badge: drawing happens in the browser
(static/attendance/badges/badge_render.js) so the designer, the template
gallery and the print sheet always agree. QR codes are also generated in
the browser (vendored qrcode-generator), which keeps the print sheet one
request instead of one request per attendee.
"""

import logging
import re
from urllib.parse import urlencode, urlparse

from django.conf import settings
from django.urls import reverse

logger = logging.getLogger(__name__)


# Registration statuses each "who" option prints.
WHO_STATUSES = {
    "accepted":   ["accepted", "checked_in"],
    "checked_in": ["checked_in"],
    "all":        ["pending", "accepted", "checked_in"],
}

# Badge tokens that come from a preset field. Anything not preset falls
# back to label matching (LABEL_HINTS) so an organiser who typed their
# own "Organisation" question still gets {org} filled in.
PRESET_TOKEN = {
    "organization": "org",
    "job_title": "title",
    "department": "dept",
    "country": "country",
}
LABEL_HINTS = [
    ("org", re.compile(r"organi[sz]ation|company|institution|agency|employer|ministry", re.I)),
    ("title", re.compile(r"job|position|designation|role title|title", re.I)),
    ("dept", re.compile(r"department|unit|division|section", re.I)),
    ("country", re.compile(r"country|nationality", re.I)),
]


def token_for_field(field):
    """Which built-in token (if any) an EventField feeds."""
    if field.preset_key in PRESET_TOKEN:
        return PRESET_TOKEN[field.preset_key]
    if field.preset_key:
        return ""
    for token, rx in LABEL_HINTS:
        if rx.search(field.label or ""):
            return token
    return ""


def field_catalog(event):
    """Every registration question, for the designer's token picker."""
    out = []
    for f in event.fields.all():
        if f.preset_key in ("full_name", "email", "phone", "consent_photo", "consent_terms"):
            continue
        out.append({
            "id": f.pk,
            "label": f.label,
            "type": f.field_type,
            "token": token_for_field(f),
            "options": f.options_list(),
        })
    return out


def _split_name(full):
    parts = (full or "").strip().split()
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], " ".join(parts[1:])


def person_payload(request, reg, number, fields_by_id):
    """
    One attendee as the renderer sees them.

    `number` is the attendee's position in registration order — printed as
    {no} (e.g. 0042). It is stable as long as nobody is deleted.
    """
    answers = {}
    builtins = {"org": "", "title": "", "dept": "", "country": ""}
    for a in reg.answers.all():
        answers[str(a.field_id)] = a.value
        field = fields_by_id.get(a.field_id)
        if field is not None:
            tok = token_for_field(field)
            if tok and not builtins.get(tok):
                builtins[tok] = a.value

    first, last = _split_name(reg.full_name)
    ticket_url = request.build_absolute_uri(
        reverse("attendance:attendee_check_in", kwargs={"token": str(reg.token)})
    )
    return {
        "id": reg.pk,
        "name": reg.full_name or reg.email or reg.phone or "",
        "first": first,
        "last": last,
        "email": reg.email,
        "phone": reg.phone,
        "no": f"{number:04d}",
        "status": reg.status,
        "walk_in": reg.is_walk_in,
        "ticket_url": ticket_url,
        "f": answers,
        **builtins,
    }


def attendees_payload(request, event, *, statuses=None, ids=None,
                      registered_after=None, sort="name", limit=None):
    """List of person payloads in print order."""
    from .models import Registration

    fields_by_id = {f.pk: f for f in event.fields.all()}

    # Number everybody in registration order first so {no} doesn't change
    # depending on which filter the organiser printed with.
    all_ids = list(
        event.registrations.order_by("registered_at", "id").values_list("id", flat=True)
    )
    number_of = {rid: i + 1 for i, rid in enumerate(all_ids)}

    qs = event.registrations.prefetch_related("answers")
    if ids:
        qs = qs.filter(pk__in=ids)
    else:
        qs = qs.filter(status__in=statuses or WHO_STATUSES["accepted"])
    if registered_after:
        qs = qs.filter(registered_at__gte=registered_after)
    # Explicit ids print whoever was picked; the status lists above never
    # include declined/cancelled, so those only appear when hand-picked.
    qs = qs.exclude(status=Registration.STATUS_CANCELLED)

    people = [person_payload(request, r, number_of.get(r.pk, 0), fields_by_id) for r in qs]

    if sort == "org":
        people.sort(key=lambda p: ((p["org"] or "~").lower(), p["name"].lower()))
    elif sort == "registered":
        people.sort(key=lambda p: p["no"])
    elif sort == "last":
        people.sort(key=lambda p: ((p["last"] or p["first"]).lower(), p["first"].lower()))
    else:
        people.sort(key=lambda p: p["name"].lower())

    if limit:
        people = people[:limit]
    return people


def blank_person(request, event):
    """A write-in badge — no name, QR goes to the walk-in check-in page."""
    return {
        "id": None, "name": "", "first": "", "last": "", "email": "", "phone": "",
        "no": "", "status": "", "walk_in": True, "blank": True,
        "ticket_url": request.build_absolute_uri(
            reverse("attendance:public_check_in", kwargs={"public_token": event.public_token})
        ),
        "f": {}, "org": "", "title": "", "dept": "", "country": "",
    }


def event_payload(request, event):
    """Event-level values for {event}, {date}, {venue}, {code} and QR modes."""
    start, end = event.starts_at, event.ends_at
    if start.date() == end.date():
        dates = start.strftime("%-d %B %Y")
    elif start.year == end.year and start.month == end.month:
        dates = f"{start.day}–{end.strftime('%-d %B %Y')}"
    elif start.year == end.year:
        dates = f"{start.strftime('%-d %b')} – {end.strftime('%-d %b %Y')}"
    else:
        dates = f"{start.strftime('%-d %b %Y')} – {end.strftime('%-d %b %Y')}"
    return {
        "title": event.title,
        "date": start.strftime("%-d %B %Y"),
        "dates": dates,
        "time": f"{start.strftime('%H:%M')} – {end.strftime('%H:%M')}",
        "venue": "Online" if event.is_online else (event.location or ""),
        "code": event.code,
        "register_url": request.build_absolute_uri(event.get_public_register_url()),
        "checkin_url": request.build_absolute_uri(
            reverse("attendance:public_check_in", kwargs={"public_token": event.public_token})
        ),
    }


def asset_map(design, user, event):
    """
    Image keys the layout may reference → URLs.

      background   the design's background photo
      cover        the event cover image
      logo         the event's certificate logo (re-used — most organisers
                   already uploaded it there)
      asset:<id>   any badge image the user uploaded on ANY of their
                   events, so "My templates" keep working across events
    """
    from .badge_models import BadgeAsset

    out = {}
    if design.background:
        out["background"] = design.background.url
    if event.cover_image:
        out["cover"] = event.cover_image.url
    if event.certificate_logo:
        out["logo"] = event.certificate_logo.url
    for a in BadgeAsset.objects.filter(design__event__owner=user):
        out[f"asset:{a.pk}"] = a.image.url
    return out


# ───────────────────── PDF via headless Chromium ─────────────────────

def render_print_pdf(request, event, query: dict) -> bytes:
    """
    Load the print sheet in headless Chromium and return PDF bytes.

    Mirrors services._render_agenda_via_browser: it forwards the
    organiser's session cookie and honours AGENDA_RENDER_BASE_URL (the
    address Django is reachable on from inside the container). The page
    sets its own @page size, so preferCSSPageSize keeps A4 / Letter /
    single-badge pages exactly as designed.

    Raises RuntimeError with a readable message if Playwright or the
    Chromium binary is missing — the view turns that into a flash message.
    """
    from .services import _try_import_playwright

    sync_playwright, PlaywrightError = _try_import_playwright()
    if sync_playwright is None:
        raise RuntimeError(
            "Playwright is not installed. Use “Open print sheet” and your "
            "browser's Print → Save as PDF instead."
        )

    q = dict(query)
    q["render"] = "pdf"
    path = reverse("attendance:badge_print", kwargs={"pk": event.pk}) + "?" + urlencode(q, doseq=True)
    base = (getattr(settings, "AGENDA_RENDER_BASE_URL", "") or "").rstrip("/")
    url = f"{base}{path}" if base else request.build_absolute_uri(path)

    cookie_host = (urlparse(base).hostname if base else None) or request.get_host().split(":")[0]
    cookies = [
        {"name": n, "value": request.COOKIES[n], "domain": cookie_host, "path": "/"}
        for n in ("sessionid", "csrftoken") if n in request.COOKIES
    ]

    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(args=["--no-sandbox"])
        except PlaywrightError as e:
            logger.exception("Playwright failed to launch Chromium for badges")
            raise RuntimeError(
                "The Chromium browser used for PDF badges isn't available on "
                "the server. Use “Open print sheet” → Print → Save as PDF, or "
                f"run `playwright install chromium` in the container. ({e})"
            ) from e
        try:
            context = browser.new_context(device_scale_factor=2)
            if cookies:
                context.add_cookies(cookies)
            page = context.new_page()
            page.goto(url, wait_until="networkidle", timeout=60000)
            try:
                page.wait_for_selector("body[data-render-ready='1']", timeout=30000)
            except Exception:
                logger.warning("badge print sheet never signalled render-ready")
            page.emulate_media(media="print")
            return page.pdf(print_background=True, prefer_css_page_size=True)
        finally:
            browser.close()
