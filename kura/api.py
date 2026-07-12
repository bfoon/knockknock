"""
kura/api.py — mobile sync API with form-code access and per-device controls.

Required models:
    Survey.device_policy:
        allow_all | manual | block_all

    SurveyDeviceAccess:
        survey, device, allowed, requested_at, decided_at, decided_by

Authentication:
    Authorization: Token <device token>
"""

from __future__ import annotations

import json
from uuid import UUID

from django.contrib.auth import authenticate
from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from .logic import validate_submission
from .live import broadcast, submission_summary
from .models import (
    Device,
    FormVersion,
    LookupDataset,
    Submission,
    Survey,
    SurveyDeviceAccess,
    SyncLog,
)

MAX_BATCH = 200


# ── response / request helpers ───────────────────────────────────────

def _bad(message: str, status: int = 400, **extra):
    payload = {"ok": False, "error": message}
    payload.update(extra)
    return JsonResponse(payload, status=status)


def _body(request):
    try:
        data = json.loads(request.body.decode("utf-8") or "{}")
    except (ValueError, UnicodeDecodeError):
        return None
    return data if isinstance(data, dict) else None


def _device(request):
    header = (request.headers.get("Authorization") or "").strip()
    if not header.startswith("Token "):
        return None

    token = header[6:].strip()
    if not token:
        return None

    device = (
        Device.objects
        .filter(token=token, is_active=True)
        .select_related("user")
        .first()
    )
    if device:
        device.touch()
    return device


def _normalise_code(value) -> str:
    return str(value or "").strip().upper()


def _published_survey(code: str):
    return (
        Survey.objects
        .filter(code=_normalise_code(code))
        .exclude(state="draft")
        .first()
    )


def _access_record(device, survey, create=False):
    query = SurveyDeviceAccess.objects.filter(
        survey=survey,
        device=device,
    )
    record = query.first()

    if record is None and create:
        record = SurveyDeviceAccess.objects.create(
            survey=survey,
            device=device,
            allowed=(survey.device_policy == "allow_all"),
        )
    return record


def _device_access(device, survey, create_pending=False):
    """
    Returns:
        (allowed: bool, status: str, record: SurveyDeviceAccess | None)

    status:
        allowed
        blocked
        pending
    """
    policy = survey.device_policy

    if policy == "block_all":
        return False, "blocked", _access_record(device, survey, create=False)

    record = _access_record(
        device,
        survey,
        create=(create_pending or policy == "manual"),
    )

    # A per-device decision overrides allow_all so an already approved
    # device can later be blocked by the implementer.
    if record is not None:
        return (
            bool(record.allowed),
            "allowed" if record.allowed else (
                "pending" if record.decided_at is None else "blocked"
            ),
            record,
        )

    if policy == "allow_all":
        return True, "allowed", None

    return False, "pending", record


def _access_denied(status: str):
    if status == "pending":
        return _bad(
            "This device is waiting for approval for this form.",
            status=403,
            access_status="pending",
        )
    return _bad(
        "This device is blocked from this form.",
        status=403,
        access_status="blocked",
    )


def _form_payload(survey, version, access_status="allowed"):
    return {
        "code": survey.code,
        "title": survey.title,
        "description": survey.description,
        "state": survey.state,
        "open": survey.is_open,
        "version": version.version,
        "schema_hash": version.schema_hash,
        "published_at": version.published_at.isoformat(),
        "access_status": access_status,
    }


def _safe_int(value, default=0, minimum=0, maximum=None):
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = default

    number = max(minimum, number)
    if maximum is not None:
        number = min(maximum, number)
    return number


# ── device registration ──────────────────────────────────────────────

@csrf_exempt
@require_POST
def device_register(request):
    data = _body(request)
    if data is None:
        return _bad("Body must be a JSON object.")

    username = str(data.get("username") or "").strip()
    password = str(data.get("password") or "")

    if not username or not password:
        return _bad("Username and password are required.")

    user = authenticate(
        request,
        username=username,
        password=password,
    )
    if not user:
        return _bad("Invalid username or password.", status=401)

    if not user.is_active:
        return _bad("This user account is disabled.", status=403)

    device = Device.issue(
        user,
        name=str(data.get("device_name") or "Phone").strip() or "Phone",
        platform=str(data.get("platform") or "").strip(),
    )

    return JsonResponse({
        "ok": True,
        "token": device.token,
        "device_id": device.id,
        "device_name": device.name,
        "platform": device.platform,
        "user": user.get_username(),
    }, status=201)


# ── scan / enter form code ───────────────────────────────────────────

@csrf_exempt
@require_POST
def form_access(request):
    """
    The phone calls this after scanning a QR code or entering a form code.

    POST /kura/api/forms/access/
    Authorization: Token <token>
    {
        "code": "ABC123"
    }
    """
    device = _device(request)
    if not device:
        return _bad("Missing or invalid device token.", status=401)

    data = _body(request)
    if data is None:
        return _bad("Body must be a JSON object.")

    code = _normalise_code(data.get("code") or data.get("form_code"))
    if not code:
        return _bad("Form code is required.")

    survey = _published_survey(code)
    if not survey:
        return _bad("Form not found.", status=404)

    version = survey.current_version
    if not version:
        return _bad("Form has no published version.", status=409)

    allowed, access_status, _record = _device_access(
        device,
        survey,
        create_pending=True,
    )

    payload = _form_payload(survey, version, access_status)
    payload.update({
        "ok": True,
        "allowed": allowed,
        "device_policy": survey.device_policy,
    })

    # Return form metadata even when pending/blocked so the phone can display
    # the correct title and access message. The schema remains protected.
    return JsonResponse(payload, status=200 if allowed else 202)


# ── manifest / form download ─────────────────────────────────────────

@require_GET
def forms_manifest(request):
    """
    Lists forms that this device has scanned/entered before.

    allow_all forms appear after the device accesses their code.
    manual forms appear as pending, allowed, or blocked.
    """
    device = _device(request)
    if not device:
        return _bad("Missing or invalid device token.", status=401)

    rows = (
        SurveyDeviceAccess.objects
        .filter(device=device)
        .select_related("survey")
        .exclude(survey__state="draft")
        .order_by("-requested_at")
    )

    forms = []
    for access in rows:
        survey = access.survey
        version = survey.current_version
        if not version:
            continue

        allowed, access_status, _ = _device_access(
            device,
            survey,
            create_pending=False,
        )

        item = _form_payload(survey, version, access_status)
        item["allowed"] = allowed
        item["device_policy"] = survey.device_policy
        forms.append(item)

    return JsonResponse({
        "ok": True,
        "server_time": timezone.now().isoformat(),
        "forms": forms,
    })


@require_GET
def form_detail(request, code):
    """
    Downloads the currently published form schema.

    The device must first scan or enter the form code through form_access().
    """
    device = _device(request)
    if not device:
        return _bad("Missing or invalid device token.", status=401)

    survey = _published_survey(code)
    if not survey:
        return _bad("Form not found.", status=404)

    # Require prior scan/code entry. This prevents the manifest or detail
    # endpoint from becoming a form-code discovery mechanism.
    access = _access_record(device, survey, create=False)
    if access is None:
        return _bad(
            "Scan the form QR code or enter the form code first.",
            status=403,
            access_status="not_requested",
        )

    allowed, access_status, _ = _device_access(
        device,
        survey,
        create_pending=False,
    )
    if not allowed:
        return _access_denied(access_status)

    version = survey.current_version
    if not version:
        return _bad("Form has no published version.", status=409)

    payload = _form_payload(survey, version, access_status)
    payload.update({
        "ok": True,
        "schema": version.schema,
    })
    return JsonResponse(payload)


# ── offline lookup download ──────────────────────────────────────────

@require_GET
def form_lookups(request, code):
    device = _device(request)
    if not device:
        return _bad("Missing or invalid device token.", status=401)

    survey = _published_survey(code)
    if not survey:
        return _bad("Form not found.", status=404)

    access = _access_record(device, survey, create=False)
    if access is None:
        return _bad(
            "Scan the form QR code or enter the form code first.",
            status=403,
            access_status="not_requested",
        )

    allowed, access_status, _ = _device_access(
        device,
        survey,
        create_pending=False,
    )
    if not allowed:
        return _access_denied(access_status)

    lookups = [
        {
            "id": dataset.id,
            "name": dataset.name,
            "key_column": dataset.key_column,
            "columns": dataset.columns,
            "rows": dataset.rows,
        }
        for dataset in LookupDataset.objects.filter(survey=survey)
    ]

    return JsonResponse({
        "ok": True,
        "code": survey.code,
        "lookups": lookups,
    })


# ── offline submission sync ──────────────────────────────────────────

@csrf_exempt
@require_POST
def form_sync(request, code):
    device = _device(request)
    if not device:
        return _bad("Missing or invalid device token.", status=401)

    survey = _published_survey(code)
    if not survey:
        return _bad("Form not found.", status=404)

    access = _access_record(device, survey, create=False)
    if access is None:
        return _bad(
            "Scan the form QR code or enter the form code first.",
            status=403,
            access_status="not_requested",
        )

    allowed, access_status, _ = _device_access(
        device,
        survey,
        create_pending=False,
    )
    if not allowed:
        return _access_denied(access_status)

    if not survey.is_open:
        return _bad(
            "This form is not currently accepting submissions.",
            status=409,
            form_state=survey.state,
        )

    data = _body(request)
    if data is None or not isinstance(data.get("submissions"), list):
        return _bad("Body must contain a 'submissions' list.")

    batch = data["submissions"][:MAX_BATCH]
    versions = {
        version.version: version
        for version in survey.versions.all()
    }
    current = survey.current_version

    results = []
    created = 0
    duplicates = 0
    rejected = 0

    with transaction.atomic():
        for item in batch:
            if not isinstance(item, dict):
                results.append({
                    "uuid": None,
                    "result": "invalid",
                    "error": "submission must be an object",
                })
                rejected += 1
                continue

            raw_uuid = str(item.get("uuid") or "").strip()
            if not raw_uuid:
                results.append({
                    "uuid": None,
                    "result": "invalid",
                    "error": "missing uuid",
                })
                rejected += 1
                continue

            try:
                client_uuid = UUID(raw_uuid)
            except (ValueError, TypeError, AttributeError):
                results.append({
                    "uuid": raw_uuid,
                    "result": "invalid",
                    "error": "uuid must be a valid UUID",
                })
                rejected += 1
                continue

            existing = Submission.objects.filter(
                client_uuid=client_uuid,
            ).first()
            if existing:
                # Do not disclose another survey's submission details.
                if existing.survey_id != survey.id:
                    results.append({
                        "uuid": raw_uuid,
                        "result": "invalid",
                        "error": "uuid already exists",
                    })
                    rejected += 1
                else:
                    results.append({
                        "uuid": raw_uuid,
                        "result": "duplicate",
                        "id": existing.id,
                    })
                    duplicates += 1
                continue

            requested_version = _safe_int(
                item.get("version"),
                default=current.version if current else 0,
            )
            form_version = versions.get(requested_version) or current

            if not form_version:
                results.append({
                    "uuid": raw_uuid,
                    "result": "invalid",
                    "error": "no published form version",
                })
                rejected += 1
                continue

            gps_in = item.get("gps")
            gps_pair = None
            if (
                isinstance(gps_in, (list, tuple))
                and len(gps_in) >= 2
                and gps_in[0] is not None
                and gps_in[1] is not None
            ):
                try:
                    gps_pair = [float(gps_in[0]), float(gps_in[1])]
                except (TypeError, ValueError):
                    gps_pair = None

            answers = item.get("answers")
            if not isinstance(answers, dict):
                answers = {}

            clean, calculations, score, errors = validate_submission(
                form_version.schema,
                answers,
                gps=gps_pair,
            )

            requested_status = str(item.get("status") or "complete").lower()
            status = (
                "partial"
                if errors or requested_status == "partial"
                else "complete"
            )

            submission = Submission.objects.create(
                survey=survey,
                form_version=form_version,
                client_uuid=client_uuid,
                answers=clean if status == "complete" else answers,
                calculations=calculations,
                score=score,
                status=status,
                source="api",
                device=device,
                enumerator=device.user,
                gps_lat=gps_pair[0] if gps_pair else None,
                gps_lng=gps_pair[1] if gps_pair else None,
                started_at=parse_datetime(
                    str(item.get("started_at") or "")
                ) or None,
                submitted_at=parse_datetime(
                    str(item.get("submitted_at") or "")
                ) or None,
                duration_ms=_safe_int(
                    item.get("duration_ms"),
                    default=0,
                    minimum=0,
                    maximum=31_536_000_000,
                ),
            )

            created += 1
            results.append({
                "uuid": raw_uuid,
                "result": "created",
                "id": submission.id,
                "status": submission.status,
                "validation_errors": errors or None,
            })

            broadcast(survey.code, {
                "type": "submission",
                "sub": submission_summary(submission),
            })

        SyncLog.objects.create(
            device=device,
            survey=survey,
            pushed=created,
            duplicates=duplicates,
            rejected=rejected,
        )

    broadcast(survey.code, {
        "type": "sync",
        "device": device.name,
        "device_id": device.id,
        "platform": device.platform,
        "enumerator": device.user.get_username(),
        "pushed": created,
        "duplicates": duplicates,
        "rejected": rejected,
        "at": timezone.now().isoformat(),
    })

    return JsonResponse({
        "ok": True,
        "received": len(batch),
        "created": created,
        "duplicates": duplicates,
        "rejected": rejected,
        "current_version": current.version if current else None,
        "results": results,
    })
