"""
kura/media.py — photos collected in surveys: store, process, find, serve.

    save_upload(survey, uuid, question, upload, …)   → (media, status)
    link_pending(survey)                              link early uploads to their submissions
    photo_items(survey, …)                            gallery rows (with answers, collector, place)
    photo_bytes(media, variant)                       for reports and Hanns decks
    photo_stats(survey)                               counts per question, for Foon
    zip_photos(items, survey)                         a ZIP with an index.csv

Processing (Pillow): the phone's orientation flag is applied, the capture
time and GPS are read from EXIF before it is stripped, and two JPEG copies
are written — "web" (≤1600 px) and "thumb" (≤480 px) — with no EXIF at all,
so a shared photo never leaks the respondent's exact coordinates.
"""

from __future__ import annotations

import csv
import io
import re
import uuid as uuidlib
import zipfile
from datetime import datetime

from django.core.files.base import ContentFile
from django.db import transaction
from django.utils import timezone

MAX_UPLOAD = 15 * 1024 * 1024
WEB_PX = 1600
THUMB_PX = 480
IMAGE_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "image/bmp"}
QUESTION_RE = re.compile(r"^[A-Za-z0-9_]{1,60}(\|[A-Za-z0-9_]{1,60}\|\d{1,4}\|[A-Za-z0-9_]{1,60})?$")


class MediaError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


# ─────────────────────────────────────────────────────────────────────
#  Image processing
# ─────────────────────────────────────────────────────────────────────

def _ratio(v):
    try:
        return float(v[0]) / float(v[1]) if isinstance(v, tuple) else float(v)
    except (TypeError, ValueError, ZeroDivisionError):
        return None


def _exif_gps(gps):
    """EXIF GPSInfo dict → (lat, lng) or (None, None)."""
    try:
        def dms(vals):
            d, m, s = (_ratio(x) for x in vals)
            return d + m / 60.0 + s / 3600.0
        lat = dms(gps[2]) * (-1 if str(gps.get(1, "N")).upper().startswith("S") else 1)
        lng = dms(gps[4]) * (-1 if str(gps.get(3, "E")).upper().startswith("W") else 1)
        if -90 <= lat <= 90 and -180 <= lng <= 180 and (lat or lng):
            return round(lat, 6), round(lng, 6)
    except Exception:
        pass
    return None, None


def process_image(data: bytes):
    """Returns dict(web, thumb, width, height, captured_at, lat, lng, fmt)."""
    from PIL import Image, ImageOps, UnidentifiedImageError
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError):
        raise MediaError("That file isn't an image Kura can read (JPEG, PNG or WebP).")
    captured_at, lat, lng = None, None, None
    try:
        exif = img.getexif()
        raw = exif.get(36867) or exif.get(306)          # DateTimeOriginal / DateTime
        if not raw:
            sub = exif.get_ifd(0x8769)
            raw = sub.get(36867) if sub else None
        if raw:
            captured_at = timezone.make_aware(datetime.strptime(str(raw)[:19], "%Y:%m:%d %H:%M:%S"))
        gps = exif.get_ifd(0x8825)
        if gps:
            lat, lng = _exif_gps(gps)
    except Exception:
        pass
    fmt = (img.format or "JPEG").upper()
    img = ImageOps.exif_transpose(img)
    if img.mode not in ("RGB", "L"):
        bg = Image.new("RGB", img.size, (255, 255, 255))
        if img.mode in ("RGBA", "LA", "P"):
            rgba = img.convert("RGBA")
            bg.paste(rgba, mask=rgba.split()[-1])
        else:
            bg.paste(img.convert("RGB"))
        img = bg
    elif img.mode == "L":
        img = img.convert("RGB")
    width, height = img.size

    def jpeg(max_px, quality):
        copy = img.copy()
        copy.thumbnail((max_px, max_px), Image.LANCZOS)
        buf = io.BytesIO()
        copy.save(buf, "JPEG", quality=quality, optimize=True, progressive=True)
        return buf.getvalue()
    return {"web": jpeg(WEB_PX, 84), "thumb": jpeg(THUMB_PX, 80), "width": width, "height": height,
            "captured_at": captured_at, "lat": lat, "lng": lng, "fmt": fmt}


# ─────────────────────────────────────────────────────────────────────
#  Saving
# ─────────────────────────────────────────────────────────────────────

def _uuid(value):
    try:
        return uuidlib.UUID(str(value))
    except (TypeError, ValueError, AttributeError):
        raise MediaError("Missing or invalid submission id (uuid).")


def photo_question_names(survey):
    """Names of photo/signature questions across every published version."""
    names = set()
    schemas = [survey.draft_schema or {}] + [v.schema or {} for v in survey.versions.all()]
    for sch in schemas:
        for q in sch.get("questions") or []:
            if not isinstance(q, dict):
                continue
            if q.get("type") in ("photo", "signature"):
                names.add(q.get("name"))
            for c in q.get("children") or []:
                if isinstance(c, dict) and c.get("type") in ("photo", "signature"):
                    names.add(c.get("name"))
    names.discard(None)
    return names


def save_upload(survey, client_uuid, question, upload, *, user=None, source="app", kind="photo"):
    """Store one photo for one answer. Idempotent: the phone may retry."""
    from .models import Submission
    from .models_media import SubmissionMedia

    cu = _uuid(client_uuid)
    question = str(question or "").strip()
    if not QUESTION_RE.match(question):
        raise MediaError("Missing or invalid question name.")
    names = photo_question_names(survey)
    if question.split("|")[-1] not in names:
        raise MediaError(f"“{question.split('|')[-1]}” isn't a photo question in this survey.")
    if upload is None:
        raise MediaError("No file was uploaded.")
    size = getattr(upload, "size", 0) or 0
    if size > MAX_UPLOAD:
        raise MediaError("That photo is larger than 15 MB.", status=413)
    # The Content-Type header isn't trusted at all (phones send
    # application/octet-stream): Pillow decides what the bytes really are in
    # process_image() and anything that isn't an image is refused there.
    data = upload.read()
    if not data:
        raise MediaError("The file is empty.")

    existing = SubmissionMedia.objects.filter(survey=survey, client_uuid=cu, question=question).first()
    if existing and existing.size == len(data):
        return existing, "duplicate"
    info = process_image(data)
    sub = Submission.objects.filter(survey=survey, client_uuid=cu).only("id", "gps_lat", "gps_lng").first()
    lat, lng = info["lat"], info["lng"]
    if lat is None and sub is not None:
        lat, lng = sub.gps_lat, sub.gps_lng
    with transaction.atomic():
        media = existing or SubmissionMedia(survey=survey, client_uuid=cu, question=question)
        if existing:
            for f in (existing.file, existing.web, existing.thumb):
                if f:
                    f.delete(save=False)
        media.kind = "signature" if kind == "signature" else "photo"
        media.submission = sub
        media.content_type = f"image/{info['fmt'].lower().replace('jpg', 'jpeg')}"
        media.size = len(data)
        media.width, media.height = info["width"], info["height"]
        media.original_name = (getattr(upload, "name", "") or "")[-160:]
        media.captured_at = info["captured_at"]
        media.gps_lat, media.gps_lng = lat, lng
        media.uploaded_by = user if getattr(user, "is_authenticated", False) else None
        media.source = source
        ext = {"PNG": "png", "WEBP": "webp", "GIF": "gif", "BMP": "bmp"}.get(info["fmt"], "jpg")
        media.file.save(f"original.{ext}", ContentFile(data), save=False)
        media.web.save("web.jpg", ContentFile(info["web"]), save=False)
        media.thumb.save("thumb.jpg", ContentFile(info["thumb"]), save=False)
        media.save()
    return media, "replaced" if existing else "created"


def link_pending(survey):
    """Photos uploaded before their answers: attach them now."""
    from .models import Submission
    from .models_media import SubmissionMedia
    pending = list(SubmissionMedia.objects.filter(survey=survey, submission__isnull=True)
                   .values_list("id", "client_uuid")[:5000])
    if not pending:
        return 0
    subs = dict(Submission.objects.filter(survey=survey, client_uuid__in={u for _i, u in pending})
                .values_list("client_uuid", "id"))
    linked = 0
    for mid, cu in pending:
        if cu in subs:
            linked += SubmissionMedia.objects.filter(id=mid).update(submission_id=subs[cu])
    return linked


# ─────────────────────────────────────────────────────────────────────
#  Finding photos
# ─────────────────────────────────────────────────────────────────────

def media_url(survey, media, variant="thumb"):
    return f"/kura/{survey.code}/media/{media.id}/?v={variant}"


def _question_labels(survey):
    labels = {}
    schema = (survey.current_version.schema if survey.current_version else survey.draft_schema) or {}
    for q in schema.get("questions") or []:
        if isinstance(q, dict) and q.get("name"):
            labels[q["name"]] = q
            for c in q.get("children") or []:
                if isinstance(c, dict) and c.get("name"):
                    labels[c["name"]] = c
    return labels


def _answer_text(q, value):
    if value in (None, "", []):
        return ""
    lm = {str(c.get("value")): c.get("label") for c in (q or {}).get("choices") or [] if isinstance(c, dict)}
    if isinstance(value, list):
        if value and isinstance(value[0], dict):
            return f"{len(value)} item(s)"
        return ", ".join(str(lm.get(str(v), v)) for v in value)
    if isinstance(value, dict):
        return ""
    return str(lm.get(str(value), value))[:120]


def summary_answers(sub, labels, limit=8, privacy=False):
    """A few readable answers of a submission to show beside its photo."""
    from .agent_engine import detect_pii, _kind_for
    out = []
    for name, value in (sub.answers or {}).items():
        q = labels.get(name)
        if not q or q.get("type") in ("photo", "signature", "audio", "gps", "mapper", "repeat", "note", "section"):
            continue
        if privacy and detect_pii({"name": name, "label": q.get("label", ""), "type": q.get("type"),
                                   "kind": _kind_for(q.get("type"))})["level"] in ("direct", "sensitive"):
            continue
        text = _answer_text(q, value)
        if text:
            out.append({"label": str(q.get("label") or name)[:80], "value": text})
        if len(out) >= limit:
            break
    return out


def photo_queryset(survey, *, include_hidden=False, starred=None, question=None, submission_ids=None):
    from .models_media import SubmissionMedia
    qs = SubmissionMedia.objects.filter(survey=survey, kind="photo").select_related("submission",
                                                                                   "submission__enumerator")
    qs = qs.exclude(submission__status="excluded")
    if not include_hidden:
        qs = qs.filter(hidden=False)
    if starred:
        qs = qs.filter(starred=True)
    if question:
        qs = qs.filter(question__endswith=question) if "|" not in question else qs.filter(question=question)
    if submission_ids is not None:
        qs = qs.filter(submission_id__in=list(submission_ids))
    return qs


def photo_items(survey, *, limit=500, offset=0, include_hidden=False, starred=None, question=None,
                submission_ids=None, answers=True, order="new", privacy=False):
    link_pending(survey)
    labels = _question_labels(survey)
    qs = photo_queryset(survey, include_hidden=include_hidden, starred=starred, question=question,
                        submission_ids=submission_ids)
    qs = qs.order_by("-starred", "-created_at") if order == "starred" else \
        qs.order_by("created_at") if order == "old" else qs.order_by("-created_at")
    total = qs.count()
    rows = []
    for m in qs[offset:offset + limit]:
        sub = m.submission
        q = labels.get(m.question_name) or {}
        who = ""
        if sub is not None and sub.enumerator_id:
            u = sub.enumerator
            who = (u.get_full_name() or u.get_username()) if u else ""
        lat = m.gps_lat if m.gps_lat is not None else (sub.gps_lat if sub else None)
        lng = m.gps_lng if m.gps_lng is not None else (sub.gps_lng if sub else None)
        rows.append({
            "id": m.id, "question": m.question, "question_name": m.question_name,
            "question_label": str(q.get("label") or m.question_name)[:140],
            "thumb": media_url(survey, m, "thumb"), "web": media_url(survey, m, "web"),
            "original": media_url(survey, m, "original"),
            "w": m.width, "h": m.height, "caption": m.caption, "starred": m.starred, "hidden": m.hidden,
            "captured_at": m.captured_at.isoformat() if m.captured_at else None,
            "received_at": (sub.received_at if sub else m.created_at).isoformat(),
            "collector": who, "source": sub.source if sub else m.source,
            "lat": lat, "lng": lng, "submission_id": sub.id if sub else None,
            "waiting": sub is None,
            "answers": summary_answers(sub, labels, privacy=privacy) if (answers and sub is not None) else [],
        })
    return {"total": total, "items": rows}


def photo_stats(survey):
    from django.db.models import Count, Q
    from .models_media import SubmissionMedia
    link_pending(survey)
    labels = _question_labels(survey)
    base = SubmissionMedia.objects.filter(survey=survey, kind="photo", hidden=False).exclude(submission__status="excluded")
    rows = (base.values("question").annotate(n=Count("id"), stars=Count("id", filter=Q(starred=True)))
            .order_by("-n"))
    by_q = {}
    for r in rows:
        name = r["question"].split("|")[-1]
        d = by_q.setdefault(name, {"name": name, "label": str((labels.get(name) or {}).get("label") or name)[:100],
                                   "count": 0, "starred": 0})
        d["count"] += r["n"]
        d["starred"] += r["stars"]
    total = sum(d["count"] for d in by_q.values())
    return {"total": total, "starred": sum(d["starred"] for d in by_q.values()),
            "with_gps": base.filter(gps_lat__isnull=False).count() if total else 0,
            "questions": sorted(by_q.values(), key=lambda d: -d["count"])}


def pick_photos(survey, n=4, *, question=None, submission_ids=None, exclude_ids=()):
    """Best photos for a report or slide: starred first, then a spread over time."""
    from .models_media import SubmissionMedia
    link_pending(survey)
    qs = photo_queryset(survey, question=question, submission_ids=submission_ids).exclude(id__in=list(exclude_ids))
    stars = list(qs.filter(starred=True).order_by("-created_at")[:n])
    if len(stars) >= n:
        return stars
    rest = list(qs.filter(starred=False).order_by("created_at").values_list("id", flat=True)[:400])
    picked = list(stars)
    if rest:
        need = n - len(picked)
        step = max(1, len(rest) // max(1, need))
        ids = rest[::step][:need]
        by_id = {m.id: m for m in SubmissionMedia.objects.filter(id__in=ids).select_related("submission")}
        picked += [by_id[i] for i in ids if i in by_id]
    return picked[:n]


def photo_bytes(media, variant="web"):
    f = {"web": media.web, "thumb": media.thumb, "original": media.file}.get(variant) or media.web or media.file
    if not f:
        return b""
    f.open("rb")
    try:
        return f.read()
    finally:
        f.close()


def photo_credit(media, labels=None):
    """'Water point — 12 Oct 2026, Brikama' style caption line."""
    labels = labels if labels is not None else _question_labels(media.survey)
    q = labels.get(media.question_name) or {}
    when = media.captured_at or (media.submission.received_at if media.submission else media.created_at)
    bits = [media.caption.strip()] if media.caption.strip() else [str(q.get("label") or "Photo")[:80]]
    if when:
        bits.append(timezone.localtime(when).strftime("%d %b %Y"))
    return " — ".join(bits)


def zip_photos(survey, media_rows):
    """ZIP of original photos plus index.csv (caption, question, time, place, collector)."""
    labels = _question_labels(survey)
    buf = io.BytesIO()
    index = io.StringIO()
    w = csv.writer(index)
    w.writerow(["file", "question", "caption", "starred", "received_at", "captured_at", "latitude", "longitude",
                "collector", "submission_id"])
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for i, m in enumerate(media_rows, 1):
            data = photo_bytes(m, "original")
            if not data:
                continue
            ext = (m.file.name.rsplit(".", 1)[-1] if m.file else "jpg")[:5]
            name = f"{i:04d}_{m.question_name}.{ext}"
            z.writestr(f"photos/{name}", data)
            sub = m.submission
            who = (sub.enumerator.get_full_name() or sub.enumerator.get_username()) if sub and sub.enumerator_id else ""
            w.writerow([name, str((labels.get(m.question_name) or {}).get("label") or m.question_name), m.caption,
                        "yes" if m.starred else "", (sub.received_at if sub else m.created_at).isoformat(),
                        m.captured_at.isoformat() if m.captured_at else "", m.gps_lat or (sub.gps_lat if sub else ""),
                        m.gps_lng or (sub.gps_lng if sub else ""), who, sub.id if sub else ""])
        z.writestr("index.csv", "\ufeff" + index.getvalue())
    return buf.getvalue()
