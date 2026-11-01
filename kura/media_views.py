"""
kura/media_views.py — getting photos in, and showing them to the right people.

Uploads
  POST /kura/api/forms/<code>/media/          phone app (Authorization: Token …)
  POST /kura/api/forms/<code>/media/check/    phone app: which of these do you still need?
  POST /kura/<code>/media/                     web runner (CSRF, survey collecting)

Gallery (owner, collaborators, supervisors — same gate as the Data page)
  GET  /kura/<code>/gallery/                   the page
  GET  /kura/<code>/gallery/data/              JSON, filtered + paged
  GET  /kura/<code>/media/<id>/?v=thumb|web|original
  POST /kura/<code>/media/<id>/update/         caption / starred / hidden
  POST /kura/<code>/gallery/bulk/              star / hide many
  GET  /kura/<code>/gallery/zip/?ids=…         originals + index.csv
"""

from __future__ import annotations

import json
import logging
from datetime import datetime

from django.contrib.auth.decorators import login_required
from django.http import FileResponse, Http404, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, render
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from . import media
from .models import Survey

logger = logging.getLogger(__name__)
MAX_PER_SUBMISSION = 40


def _err(msg, status=400):
    return JsonResponse({"ok": False, "error": msg}, status=status)


# ─────────────────────────── uploads: phone app ───────────────────────────

def _device_gate(request, code, need_open=True):
    """Exactly the gates form_sync applies, so a phone can upload a photo
    if and only if it could sync the answers it belongs to."""
    from .api import _access_denied, _access_record, _device, _device_access, _published_survey
    device = _device(request)
    if device is None:
        return None, None, _err("Missing or invalid device token.", 401)
    survey = _published_survey(code)
    if survey is None:
        return None, None, _err("Form not found.", 404)
    if _access_record(device, survey, create=False) is None:
        return None, None, JsonResponse({"ok": False, "error": "Scan the form QR code or enter the form code first.",
                                         "access_status": "not_requested"}, status=403)
    allowed, status, _rec = _device_access(device, survey, create_pending=False)
    if not allowed:
        return None, None, _access_denied(status)
    if need_open and not survey.is_open:
        return None, None, JsonResponse({"ok": False, "error": "This form is not currently accepting submissions.",
                                         "form_state": survey.state}, status=409)
    return device, survey, None


@csrf_exempt
@require_POST
def api_media_upload(request, code):
    device, survey, denied = _device_gate(request, code)
    if denied:
        return denied
    try:
        m, how = media.save_upload(survey, request.POST.get("uuid"), request.POST.get("question"),
                                   request.FILES.get("file"), user=device.user, source="app",
                                   kind=request.POST.get("kind") or "photo")
    except media.MediaError as e:
        return _err(str(e), e.status)
    except Exception:
        logger.exception("Kura media upload failed")
        return _err("The server could not store this photo — it will be retried.", 500)
    return JsonResponse({"ok": True, "id": m.id, "result": how})


@csrf_exempt
@require_POST
def api_media_check(request, code):
    """{"items":[{"uuid","question","size"}]} → {"missing":[indexes]}. Lets the
    phone skip photos the server already has when a sync is retried."""
    from .api import _body
    from .models_media import SubmissionMedia
    _device_obj, survey, denied = _device_gate(request, code, need_open=False)
    if denied:
        return denied
    data = _body(request) or {}
    items = data.get("items") if isinstance(data.get("items"), list) else []
    have = {}
    uuids = []
    for it in items[:500]:
        try:
            uuids.append(media._uuid(it.get("uuid")))
        except media.MediaError:
            pass
    for cu, q, size in SubmissionMedia.objects.filter(survey=survey, client_uuid__in=uuids) \
            .values_list("client_uuid", "question", "size"):
        have[(str(cu), q)] = size
    missing = []
    for i, it in enumerate(items[:500]):
        key = (str(it.get("uuid")), str(it.get("question")))
        if key not in have or (it.get("size") and int(it.get("size") or 0) != have[key]):
            missing.append(i)
    return JsonResponse({"ok": True, "missing": missing})


# ─────────────────────────── uploads: web runner ───────────────────────────

@require_POST
def collect_media(request, code):
    from .models_media import SubmissionMedia
    survey = get_object_or_404(Survey, code=code.upper())
    if request.GET.get("preview"):
        if not request.user.is_authenticated or survey.owner_id != request.user.id:
            return _err("Preview is owner-only.", 403)
        f = request.FILES.get("file")
        if f is None:
            return _err("No file was uploaded.")
        try:
            media.process_image(f.read())
        except media.MediaError as e:
            return _err(str(e))
        return JsonResponse({"ok": True, "preview": True, "id": 0})
    if survey.state != "collecting" or survey.current_version is None:
        return _err("This survey isn't accepting answers right now.", 409)
    try:
        cu = media._uuid(request.POST.get("uuid"))
    except media.MediaError as e:
        return _err(str(e))
    if SubmissionMedia.objects.filter(survey=survey, client_uuid=cu).count() >= MAX_PER_SUBMISSION:
        return _err("Too many photos for one response.", 429)
    from .models import Submission
    if Submission.objects.filter(survey=survey, client_uuid=cu).exists():
        return _err("This response was already submitted.", 409)
    try:
        m, how = media.save_upload(survey, cu, request.POST.get("question"), request.FILES.get("file"),
                                   user=request.user, source="web")
    except media.MediaError as e:
        return _err(str(e), e.status)
    except Exception:
        logger.exception("Kura web media upload failed")
        return _err("The photo could not be saved — try again.", 500)
    return JsonResponse({"ok": True, "id": m.id, "result": how})


# ─────────────────────────── gallery ───────────────────────────

def _gate(request, code, need="view"):
    """(survey, ctx) for a viewer allowed to see this survey's data."""
    from .agent_views import Denied, build_context
    try:
        ctx = build_context(request.user, code, "gallery")
    except Denied:
        raise Http404
    if not ctx.can.get(need):
        raise Http404
    return ctx.survey, ctx


def _scoped_ids(ctx):
    """Supervisors without whole-survey view see their teams' submissions only."""
    if ctx.scope_user_ids is None:
        return None
    from .models import Submission
    return set(Submission.objects.filter(survey=ctx.survey, enumerator_id__in=ctx.scope_user_ids)
               .values_list("id", flat=True))


def _filtered_submission_ids(survey, request, scope):
    """Answer / collector / date filters → submission ids (None = no filter)."""
    from .models import Submission
    field, value = request.GET.get("field"), request.GET.get("value")
    collector, date_from, date_to = request.GET.get("collector"), request.GET.get("from"), request.GET.get("to")
    if not any([field and value, collector, date_from, date_to]) and scope is None:
        return None
    qs = Submission.objects.filter(survey=survey).exclude(status="excluded")
    if scope is not None:
        qs = qs.filter(id__in=scope)
    if collector:
        qs = qs.filter(enumerator_id=collector) if collector.isdigit() else qs.none()
    for key, op in ((date_from, "gte"), (date_to, "lte")):
        if key:
            try:
                d = datetime.strptime(key[:10], "%Y-%m-%d").date()
                qs = qs.filter(**{f"received_at__date__{op}": d})
            except ValueError:
                pass
    if field and value:
        ids = []
        for sid, ans in qs.values_list("id", "answers"):
            v = (ans or {}).get(field)
            if v == value or str(v) == value or (isinstance(v, list) and value in [str(x) for x in v]) or \
                    (isinstance(v, str) and " " in v and value in v.split()):
                ids.append(sid)
        return set(ids)
    return set(qs.values_list("id", flat=True))


@login_required
@require_GET
def gallery(request, code):
    survey, ctx = _gate(request, code)
    from .media import _question_labels, photo_stats
    labels = _question_labels(survey)
    choice_fields = [{"name": n, "label": str(q.get("label") or n)[:80],
                      "choices": [{"value": str(c.get("value")), "label": str(c.get("label") or c.get("value"))}
                                  for c in (q.get("choices") or []) if isinstance(c, dict)][:80]}
                     for n, q in labels.items() if q.get("type") in ("select_one", "select_multiple", "likert")][:40]
    from django.contrib.auth import get_user_model
    collectors = list(get_user_model().objects.filter(
        id__in=survey.submissions.exclude(enumerator__isnull=True).values("enumerator_id").distinct())
        .values("id", "first_name", "last_name", "username")[:200])
    cfg = {
        "code": survey.code, "title": survey.title,
        "stats": photo_stats(survey),
        "choiceFields": choice_fields,
        "collectors": [{"id": c["id"], "name": (f"{c['first_name']} {c['last_name']}".strip() or c["username"])}
                       for c in collectors],
        "can": {"edit": bool(ctx.can.get("dashboards") or ctx.can.get("build")), "export": bool(ctx.can.get("export"))},
        "urls": {"data": f"/kura/{survey.code}/gallery/data/", "bulk": f"/kura/{survey.code}/gallery/bulk/",
                 "zip": f"/kura/{survey.code}/gallery/zip/", "media": f"/kura/{survey.code}/media/",
                 "dataPage": f"/kura/{survey.code}/data/", "builder": f"/kura/{survey.code}/build/"},
    }
    return render(request, "kura/gallery.html", {"survey": survey, "cfg": cfg})


@login_required
@require_GET
def gallery_data(request, code):
    survey, ctx = _gate(request, code)
    scope = _scoped_ids(ctx)
    ids = _filtered_submission_ids(survey, request, scope)
    can_edit = bool(ctx.can.get("dashboards") or ctx.can.get("build"))
    try:
        offset = max(0, int(request.GET.get("offset") or 0))
        limit = max(1, min(120, int(request.GET.get("limit") or 60)))
    except ValueError:
        offset, limit = 0, 60
    res = media.photo_items(survey, limit=limit, offset=offset, question=request.GET.get("q") or None,
                            starred=request.GET.get("starred") == "1",
                            include_hidden=can_edit and request.GET.get("hidden") == "1",
                            submission_ids=ids, order=request.GET.get("order") or "new",
                            # Galleries get projected and screen-shared: no names, phone
                            # numbers or open text beside photos (the response is one click away).
                            privacy=True)
    caption_q = (request.GET.get("search") or "").strip().lower()
    if caption_q:
        res["items"] = [i for i in res["items"] if caption_q in (i["caption"] or "").lower()
                        or caption_q in i["question_label"].lower()
                        or any(caption_q in a["value"].lower() for a in i["answers"])]
    return JsonResponse({"ok": True, **res, "offset": offset, "limit": limit})


@login_required
@require_GET
def media_file(request, code, media_id):
    survey, ctx = _gate(request, code)
    from .models_media import SubmissionMedia
    m = get_object_or_404(SubmissionMedia, survey=survey, id=media_id)
    scope = _scoped_ids(ctx)
    if scope is not None and m.submission_id not in scope:
        raise Http404
    variant = request.GET.get("v") or "thumb"
    f = {"thumb": m.thumb, "web": m.web, "original": m.file}.get(variant) or m.web or m.file
    if not f:
        raise Http404
    try:
        handle = f.open("rb")
    except (FileNotFoundError, OSError):
        raise Http404
    ctype = "image/jpeg" if variant in ("thumb", "web") else (m.content_type or "image/jpeg")
    resp = FileResponse(handle, content_type=ctype)
    resp["Cache-Control"] = "private, max-age=86400"
    if variant == "original":
        ext = f.name.rsplit(".", 1)[-1] if "." in f.name else "jpg"
        resp["Content-Disposition"] = f'attachment; filename="{survey.code}_{m.question_name}_{m.id}.{ext}"'
    return resp


@login_required
@require_POST
def media_update(request, code, media_id):
    survey, ctx = _gate(request, code)
    if not (ctx.can.get("dashboards") or ctx.can.get("build")):
        return _err("You can view these photos but not edit them.", 403)
    from .models_media import SubmissionMedia
    m = get_object_or_404(SubmissionMedia, survey=survey, id=media_id)
    try:
        data = json.loads(request.body.decode("utf-8") or "{}")
    except ValueError:
        return _err("Malformed request.")
    fields = []
    if "caption" in data:
        m.caption = str(data.get("caption") or "")[:600]
        fields.append("caption")
    for key in ("starred", "hidden"):
        if key in data:
            setattr(m, key, bool(data[key]))
            fields.append(key)
    if fields:
        m.save(update_fields=fields + ["updated_at"])
    return JsonResponse({"ok": True, "caption": m.caption, "starred": m.starred, "hidden": m.hidden})


@login_required
@require_POST
def gallery_bulk(request, code):
    survey, ctx = _gate(request, code)
    if not (ctx.can.get("dashboards") or ctx.can.get("build")):
        return _err("You can view these photos but not edit them.", 403)
    from .models_media import SubmissionMedia
    try:
        data = json.loads(request.body.decode("utf-8") or "{}")
    except ValueError:
        return _err("Malformed request.")
    ids = [int(i) for i in (data.get("ids") or []) if str(i).isdigit()][:1000]
    upd = {k: bool(data[k]) for k in ("starred", "hidden") if k in data}
    if not ids or not upd:
        return _err("Nothing to change.")
    n = SubmissionMedia.objects.filter(survey=survey, id__in=ids).update(updated_at=timezone.now(), **upd)
    return JsonResponse({"ok": True, "updated": n})


@login_required
@require_GET
def gallery_zip(request, code):
    survey, ctx = _gate(request, code, need="export")
    scope = _scoped_ids(ctx)
    ids = [int(i) for i in (request.GET.get("ids") or "").split(",") if i.strip().isdigit()][:2000]
    qs = media.photo_queryset(survey, starred=request.GET.get("starred") == "1", question=request.GET.get("q") or None)
    if ids:
        qs = qs.filter(id__in=ids)
    if scope is not None:
        qs = qs.filter(submission_id__in=scope)
    rows = list(qs.order_by("created_at")[:2000])
    if not rows:
        return _err("No photos to download.", 404)
    data = media.zip_photos(survey, rows)
    resp = HttpResponse(data, content_type="application/zip")
    resp["Content-Disposition"] = f'attachment; filename="{survey.code}_photos_{timezone.localdate().isoformat()}.zip"'
    return resp
