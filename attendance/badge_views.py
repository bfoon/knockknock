"""
Badge designer + print sheet.

ORGANIZER-SIDE only (login_required, owner-only):
  badge_designer          the drag-and-drop designer page
  badge_save              JSON — saves layout (+ print settings)
  badge_upload            multipart — background photo or extra image
  badge_background_clear  removes the background photo
  badge_asset_delete      removes an uploaded image
  badge_library_save      "Save as my template"
  badge_library_apply     load one of my templates into this event
  badge_library_delete    delete one of my templates
  badge_print             the printable sheet (A4 / Letter / A3 / one per page)
  badge_pdf               same sheet rendered to PDF server-side

Importing badge_models here is what registers the badge tables with Django
(urls.py imports this module) — same mechanism the feedback app uses.
"""

import json
from datetime import datetime

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.core.files.base import ContentFile
from django.http import HttpResponse, HttpResponseBadRequest, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.utils.text import slugify
from django.views.decorators.http import require_GET, require_POST

from .badge_models import BadgeAsset, BadgeDesign, SavedBadgeTemplate
from . import badge_services as bs
from .models import AttendanceEvent

MAX_LAYOUT_BYTES = 400_000
MAX_ELEMENTS = 150
MAX_UPLOAD_BYTES = 15 * 1024 * 1024
ALLOWED_IMAGE_FORMATS = {"PNG", "JPEG", "WEBP", "GIF"}

PAPER_CHOICES = {"a4", "letter", "a3", "single"}
SORT_CHOICES = {"name", "last", "org", "registered"}

DEFAULT_PRINT_OPTS = {
    "who": "accepted",
    "sort": "name",
    "paper": "a4",
    "orient": "auto",
    "margin": 8,
    "gap": 4,
    "crop": True,
    "blank": 0,
    "copies": 1,
}


# ─────────────────── helpers ───────────────────

def _own_event_or_404(user, pk):
    return get_object_or_404(AttendanceEvent, pk=pk, owner=user)


def _design_for(event):
    design, _ = BadgeDesign.objects.get_or_create(event=event)
    return design


def _json_body(request):
    try:
        return json.loads(request.body.decode("utf-8") or "{}")
    except (ValueError, UnicodeDecodeError):
        return None


def _validate_layout(layout):
    """Return an error string, or "" if the layout is acceptable."""
    if not isinstance(layout, dict):
        return "Layout must be an object."
    if len(json.dumps(layout)) > MAX_LAYOUT_BYTES:
        return "This design is too large to save."
    els = layout.get("els", [])
    if not isinstance(els, list):
        return "Layout elements must be a list."
    if len(els) > MAX_ELEMENTS:
        return f"A badge can hold at most {MAX_ELEMENTS} elements."
    return ""


def _check_image(upload):
    """Reject non-images and oversized files. Returns an error or ""."""
    if upload is None:
        return "No file received."
    if upload.size > MAX_UPLOAD_BYTES:
        return "That image is larger than 15 MB."
    try:
        from PIL import Image
        img = Image.open(upload)
        fmt = (img.format or "").upper()
        img.verify()
    except Exception:
        return "That file is not an image we can use (PNG, JPG, WebP or GIF)."
    finally:
        upload.seek(0)
    if fmt not in ALLOWED_IMAGE_FORMATS:
        return "Please upload a PNG, JPG, WebP or GIF image."
    return ""


def _copy_file(src_field, dst_field, name_hint):
    """Copy an ImageField's file into another ImageField (new file on disk)."""
    if not src_field:
        return
    src_field.open("rb")
    try:
        data = src_field.read()
    finally:
        src_field.close()
    ext = (src_field.name.rsplit(".", 1)[-1] if "." in src_field.name else "png").lower()
    dst_field.save(f"{slugify(name_hint) or 'badge'}.{ext}", ContentFile(data), save=False)


def _print_opts(design, params):
    """Saved print settings, overridden by whatever is in the query string."""
    opts = {**DEFAULT_PRINT_OPTS, **(design.print_opts or {})}

    def _num(name, lo, hi, cast=float):
        raw = params.get(name)
        if raw in (None, ""):
            return
        try:
            opts[name] = max(lo, min(hi, cast(raw)))
        except (TypeError, ValueError):
            pass

    who = params.get("who")
    if who in bs.WHO_STATUSES:
        opts["who"] = who
    if params.get("sort") in SORT_CHOICES:
        opts["sort"] = params["sort"]
    if params.get("paper") in PAPER_CHOICES:
        opts["paper"] = params["paper"]
    if params.get("orient") in ("auto", "portrait", "landscape"):
        opts["orient"] = params["orient"]
    _num("margin", 0, 40)
    _num("gap", 0, 30)
    _num("blank", 0, 500, int)
    _num("copies", 1, 10, int)
    if "crop" in params:
        opts["crop"] = params.get("crop") in ("1", "true", "on", "yes")
    return opts


def _parse_ids(raw):
    out = []
    for part in (raw or "").split(","):
        part = part.strip()
        if part.isdigit():
            out.append(int(part))
    return out


def _parse_after(raw):
    if not raw:
        return None
    for fmt in ("%Y-%m-%dT%H:%M", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(raw, fmt)
            return timezone.make_aware(dt) if timezone.is_naive(dt) else dt
        except ValueError:
            continue
    return None


# ─────────────────── designer ───────────────────

@login_required
def badge_designer(request, pk):
    event = _own_event_or_404(request.user, pk)
    design = _design_for(event)

    sample_people = bs.attendees_payload(
        request, event, statuses=bs.WHO_STATUSES["all"], sort="registered", limit=1000,
    )

    saved = [
        {
            "id": t.pk,
            "name": t.name,
            "layout": t.layout,
            "background": t.background.url if t.background else "",
        }
        for t in SavedBadgeTemplate.objects.filter(owner=request.user)
    ]
    assets = [
        {"key": f"asset:{a.pk}", "id": a.pk, "url": a.image.url, "label": a.label}
        for a in BadgeAsset.objects.filter(design__event__owner=request.user)
    ]

    boot = {
        "layout": design.layout or {},
        "templateKey": design.template_key,
        "printOpts": {**DEFAULT_PRINT_OPTS, **(design.print_opts or {})},
        "people": sample_people,
        "fields": bs.field_catalog(event),
        "event": bs.event_payload(request, event),
        "assetMap": bs.asset_map(design, request.user, event),
        "assets": assets,
        "saved": saved,
        "attendeeCount": len(bs.attendees_payload(request, event)),
    }
    return render(request, "attendance/badge_designer.html", {
        "event": event,
        "design": design,
        "boot": boot,
    })


@login_required
@require_POST
def badge_save(request, pk):
    event = _own_event_or_404(request.user, pk)
    design = _design_for(event)
    data = _json_body(request)
    if data is None:
        return HttpResponseBadRequest("Invalid JSON.")

    update = []
    if "layout" in data:
        err = _validate_layout(data["layout"])
        if err:
            return JsonResponse({"ok": False, "error": err}, status=400)
        design.layout = data["layout"]
        update.append("layout")
    if "template_key" in data:
        design.template_key = str(data.get("template_key") or "")[:40]
        update.append("template_key")
    if isinstance(data.get("print_opts"), dict):
        design.print_opts = _print_opts(design, {
            k: ("1" if v is True else "0" if v is False else str(v))
            for k, v in data["print_opts"].items()
        })
        update.append("print_opts")
    if update:
        design.save(update_fields=update + ["updated_at"])
    return JsonResponse({"ok": True, "saved_at": timezone.now().strftime("%H:%M:%S")})


@login_required
@require_POST
def badge_upload(request, pk):
    event = _own_event_or_404(request.user, pk)
    design = _design_for(event)
    kind = request.POST.get("kind", "asset")
    upload = request.FILES.get("image")
    err = _check_image(upload)
    if err:
        return JsonResponse({"ok": False, "error": err}, status=400)

    if kind == "background":
        if design.background:
            design.background.delete(save=False)
        design.background.save(upload.name, upload, save=False)
        design.save(update_fields=["background", "updated_at"])
        return JsonResponse({"ok": True, "key": "background", "url": design.background.url})

    asset = BadgeAsset(design=design, label=(request.POST.get("label") or upload.name)[:120])
    asset.image.save(upload.name, upload, save=False)
    asset.save()
    return JsonResponse({
        "ok": True, "key": f"asset:{asset.pk}", "id": asset.pk,
        "url": asset.image.url, "label": asset.label,
    })


@login_required
@require_POST
def badge_background_clear(request, pk):
    event = _own_event_or_404(request.user, pk)
    design = _design_for(event)
    if design.background:
        design.background.delete(save=False)
        design.background = None
        design.save(update_fields=["background", "updated_at"])
    return JsonResponse({"ok": True})


@login_required
@require_POST
def badge_asset_delete(request, pk, asset_id):
    _own_event_or_404(request.user, pk)
    asset = get_object_or_404(BadgeAsset, pk=asset_id, design__event__owner=request.user)
    asset.image.delete(save=False)
    asset.delete()
    return JsonResponse({"ok": True})


# ─────────────────── my templates ───────────────────

@login_required
@require_POST
def badge_library_save(request, pk):
    event = _own_event_or_404(request.user, pk)
    design = _design_for(event)
    data = _json_body(request) or {}
    name = (data.get("name") or "").strip()[:120]
    if not name:
        return JsonResponse({"ok": False, "error": "Give your template a name."}, status=400)
    layout = data.get("layout", design.layout)
    err = _validate_layout(layout)
    if err:
        return JsonResponse({"ok": False, "error": err}, status=400)

    tpl = SavedBadgeTemplate(owner=request.user, name=name, layout=layout)
    if design.background:
        _copy_file(design.background, tpl.background, name)
    tpl.save()
    return JsonResponse({
        "ok": True,
        "template": {
            "id": tpl.pk, "name": tpl.name, "layout": tpl.layout,
            "background": tpl.background.url if tpl.background else "",
        },
    })


@login_required
@require_POST
def badge_library_apply(request, pk, tid):
    event = _own_event_or_404(request.user, pk)
    design = _design_for(event)
    tpl = get_object_or_404(SavedBadgeTemplate, pk=tid, owner=request.user)

    design.layout = tpl.layout
    design.template_key = f"mine:{tpl.pk}"
    if tpl.background:
        if design.background:
            design.background.delete(save=False)
        _copy_file(tpl.background, design.background, tpl.name)
    design.save()
    return JsonResponse({
        "ok": True,
        "layout": design.layout,
        "background": design.background.url if design.background else "",
    })


@login_required
@require_POST
def badge_library_delete(request, pk, tid):
    _own_event_or_404(request.user, pk)
    tpl = get_object_or_404(SavedBadgeTemplate, pk=tid, owner=request.user)
    if tpl.background:
        tpl.background.delete(save=False)
    tpl.delete()
    return JsonResponse({"ok": True})


# ─────────────────── print sheet + PDF ───────────────────

def _print_context(request, event, design):
    opts = _print_opts(design, request.GET)
    ids = _parse_ids(request.GET.get("ids"))
    # Printing specific people (e.g. the badge button on an attendee row)
    # should never pull in the saved "extra blank badges" setting.
    if ids and "blank" not in request.GET:
        opts["blank"] = 0
    people = bs.attendees_payload(
        request, event,
        statuses=bs.WHO_STATUSES[opts["who"]],
        ids=ids or None,
        registered_after=_parse_after(request.GET.get("after")),
        sort=opts["sort"],
    )
    copies = int(opts["copies"])
    if copies > 1:
        people = [p for p in people for _ in range(copies)]
    people += [bs.blank_person(request, event) for _ in range(int(opts["blank"]))]

    return {
        "event": event,
        "design": design,
        "opts": opts,
        "is_pdf": request.GET.get("render") == "pdf",
        "query": request.GET.urlencode(),
        "boot": {
            "layout": design.layout or {},
            "templateKey": design.template_key,
            "opts": opts,
            "people": people,
            "event": bs.event_payload(request, event),
            "assetMap": bs.asset_map(design, request.user, event),
            "fields": bs.field_catalog(event),
        },
    }


@login_required
@require_GET
def badge_print(request, pk):
    event = _own_event_or_404(request.user, pk)
    design = _design_for(event)
    return render(request, "attendance/badge_print.html", _print_context(request, event, design))


@login_required
@require_GET
def badge_pdf(request, pk):
    event = _own_event_or_404(request.user, pk)
    try:
        data = bs.render_print_pdf(request, event, request.GET.dict())
    except RuntimeError as e:
        messages.error(request, f"Could not make the badge PDF: {e}")
        return redirect("attendance:badge_designer", pk=event.pk)
    slug = slugify(event.title) or f"event-{event.pk}"
    resp = HttpResponse(data, content_type="application/pdf")
    resp["Content-Disposition"] = f'attachment; filename="{slug}-badges.pdf"'
    resp["Content-Length"] = str(len(data))
    return resp
