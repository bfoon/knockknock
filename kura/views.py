"""
kura/views.py — web UI for the survey lifecycle.

Owner pages (login required): list, builder, data/cleaning workbench.
Public page: the web runner at /kura/<code>/ (the URL in the share QR).
Mobile devices use kura/api.py instead of these views.
"""

from __future__ import annotations

import csv
import io
import json
from datetime import timedelta

from django.contrib.auth.decorators import login_required
from django.http import (
    Http404, HttpResponse, JsonResponse,
)
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.views.decorators.http import require_GET, require_POST

from .cleaning import default_rules, run_rules
from .live import broadcast, submission_summary
from .logic import validate_submission
from .models import (
    AnswerEdit, CleaningRule, Device, FormVersion, LookupDataset,
    Submission, SubmissionFlag, Survey, SurveyDeviceAccess, SyncLog,
)


# ── helpers ──────────────────────────────────────────────────────────

def _own(request, code):
    survey = get_object_or_404(Survey, code=code.upper())
    if survey.owner_id != request.user.id:
        raise Http404
    return survey


def _body(request):
    try:
        return json.loads(request.body.decode("utf-8") or "{}")
    except (ValueError, UnicodeDecodeError):
        return None


DEFAULT_SCHEMA = {
    "settings": {"anonymous": True, "shuffle_questions": False, "languages": ["en"]},
    "questions": [],
}


# ── build ────────────────────────────────────────────────────────────

@login_required
def survey_list(request):
    surveys = Survey.objects.filter(owner=request.user)
    rows = []
    for s in surveys:
        rows.append({
            "obj": s,
            "responses": s.submissions.exclude(status="excluded").count(),
            "version": s.current_version.version if s.current_version else 0,
        })
    return render(request, "kura/survey_list.html", {
        "rows": rows, "total": surveys.count(),
    })


@login_required
@require_POST
def survey_create(request):
    survey = Survey.objects.create(
        owner=request.user,
        title=(request.POST.get("title") or "Untitled survey").strip()[:140],
        draft_schema=dict(DEFAULT_SCHEMA),
    )
    return redirect("kura:builder", code=survey.code)


@login_required
def builder(request, code):
    survey = _own(request, code)
    lookups = [{"id": d.id, "name": d.name, "key_column": d.key_column,
                "columns": d.columns, "rows": len(d.rows or [])}
               for d in survey.lookups.all()]
    return render(request, "kura/builder.html", {
        "survey": survey,
        "survey_json": json.dumps(survey.as_dict()),
        "lookups_json": json.dumps(lookups),
        "collect_url": request.build_absolute_uri(f"/kura/{survey.code}/"),
    })


@login_required
@require_POST
def builder_save(request, code):
    survey = _own(request, code)
    data = _body(request)
    if data is None:
        return JsonResponse({"ok": False, "error": "Body must be JSON."}, status=400)
    if "title" in data:
        survey.title = str(data["title"]).strip()[:140] or survey.title
    if "description" in data:
        survey.description = str(data["description"])[:2000]
    if "quota" in data:
        try:
            survey.quota = max(0, int(data["quota"]))
        except (TypeError, ValueError):
            pass
    if isinstance(data.get("schema"), dict):
        schema = data["schema"]
        # Minimal server-side sanity: unique non-empty machine names.
        seen = set()
        for q in schema.get("questions") or []:
            name = str(q.get("name") or "").strip()
            if not name or name in seen:
                return JsonResponse({
                    "ok": False,
                    "error": f"Question names must be unique and non-empty (problem: {name or 'blank'}).",
                }, status=400)
            seen.add(name)
        survey.draft_schema = schema
    survey.save()
    return JsonResponse({"ok": True, "saved_at": timezone.now().isoformat()})


@login_required
@require_POST
def publish(request, code):
    survey = _own(request, code)
    if not (survey.draft_schema or {}).get("questions"):
        return JsonResponse({"ok": False, "error": "Add at least one question before publishing."}, status=400)
    survey.versions.update(is_current=False)
    last = survey.versions.order_by("-version").first()
    fv = FormVersion.objects.create(
        survey=survey,
        version=(last.version + 1) if last else 1,
        schema=survey.draft_schema,
        is_current=True,
        published_by=request.user,
    )
    survey.state = "collecting"
    survey.save(update_fields=["state", "updated_at"])
    default_rules(survey)
    return JsonResponse({"ok": True, "version": fv.version})


@login_required
@require_POST
def set_state(request, code):
    survey = _own(request, code)
    state = request.POST.get("state") or (_body(request) or {}).get("state")
    if state in ("collecting", "paused", "closed"):
        if state == "collecting" and not survey.current_version:
            return JsonResponse({"ok": False, "error": "Publish the survey first."}, status=400)
        survey.state = state
        survey.save(update_fields=["state", "updated_at"])
        return JsonResponse({"ok": True, "state": state})
    return JsonResponse({"ok": False, "error": "state must be collecting|paused|closed"}, status=400)


@login_required
@require_POST
def survey_delete(request, code):
    from django.utils.http import url_has_allowed_host_and_scheme

    _own(request, code).delete()
    # Honor the dashboard's `next` field (same pattern as the other apps),
    # but only for safe same-host URLs.
    nxt = request.POST.get("next")
    if nxt and url_has_allowed_host_and_scheme(nxt, allowed_hosts={request.get_host()}):
        return redirect(nxt)
    return redirect("kura:list")


# ── collect (public web runner) ──────────────────────────────────────

def collect(request, code):
    survey = get_object_or_404(Survey, code=code.upper())
    version = survey.current_version
    return render(request, "kura/collect.html", {
        "survey": survey,
        "preview": False,
        "open": survey.is_open and version is not None,
        "payload": json.dumps({
            "code": survey.code,
            "title": survey.title,
            "description": survey.description,
            "version": version.version if version else 0,
            "schema": version.schema if version else {"questions": []},
        }),
    })


@login_required
def preview(request, code):
    """The builder's live preview: always renders the DRAFT schema.

    Refreshes itself whenever the tab regains focus, so builder edits
    (autosaved within a second) show up immediately — no publish needed.
    Submissions validate for real but are never stored.
    """
    survey = _own(request, code)
    return render(request, "kura/collect.html", {
        "survey": survey,
        "preview": True,
        "open": True,
        "payload": json.dumps({
            "code": survey.code,
            "title": survey.title,
            "description": survey.description,
            "version": survey.current_version.version if survey.current_version else 0,
            "schema": survey.draft_schema or {"questions": []},
        }),
    })


@login_required
def preview_schema(request, code):
    """Fresh draft schema for the preview page's live-refresh."""
    survey = _own(request, code)
    return JsonResponse({"ok": True,
                         "schema": survey.draft_schema or {"questions": []}})


@require_POST
def collect_submit(request, code):
    survey = get_object_or_404(Survey, code=code.upper())

    # Preview mode: the owner exercises the DRAFT schema — full validation,
    # skip logic, geofencing, lookups — but nothing is stored.
    if request.GET.get("preview"):
        if not request.user.is_authenticated or survey.owner_id != request.user.id:
            return JsonResponse({"ok": False, "error": "Preview is owner-only."}, status=403)
        data = _body(request)
        if data is None:
            return JsonResponse({"ok": False, "error": "Body must be JSON."}, status=400)
        gps_in = data.get("gps")
        gps_pair = (list(gps_in)[:2]
                    if isinstance(gps_in, (list, tuple)) and len(gps_in) >= 2
                    and gps_in[0] is not None else None)
        clean, calcs, score, errors = validate_submission(
            survey.draft_schema or {"questions": []},
            data.get("answers") or {}, gps=gps_pair)
        if errors:
            return JsonResponse({"ok": False, "errors": errors}, status=422)
        return JsonResponse({"ok": True, "preview": True,
                             "clean": clean, "calculations": calcs, "score": score})

    if not survey.is_open:
        return JsonResponse({"ok": False, "error": "This survey is not accepting responses."}, status=409)
    version = survey.current_version
    if not version:
        return JsonResponse({"ok": False, "error": "No published version."}, status=409)

    data = _body(request)
    if data is None:
        return JsonResponse({"ok": False, "error": "Body must be JSON."}, status=400)

    gps_in = data.get("gps")
    gps_pair = (list(gps_in)[:2]
                if isinstance(gps_in, (list, tuple)) and len(gps_in) >= 2
                and gps_in[0] is not None else None)
    clean, calcs, score, errors = validate_submission(
        version.schema, data.get("answers") or {}, gps=gps_pair)
    if errors:
        return JsonResponse({"ok": False, "errors": errors}, status=422)

    client_uuid = str(data.get("uuid") or "").strip()
    if client_uuid and Submission.objects.filter(client_uuid=client_uuid).exists():
        return JsonResponse({"ok": True, "duplicate": True})

    sub = Submission(
        survey=survey, form_version=version,
        answers=clean, calculations=calcs, score=score,
        status="complete", source="web",
        gps_lat=gps_pair[0] if gps_pair else None,
        gps_lng=gps_pair[1] if gps_pair else None,
        started_at=parse_datetime(data.get("started_at") or "") or None,
        submitted_at=timezone.now(),
        duration_ms=int(data.get("duration_ms") or 0),
    )
    if client_uuid:
        sub.client_uuid = client_uuid
    sub.save()
    # Live monitor: web submissions appear instantly too.
    broadcast(survey.code, {"type": "submission", "sub": submission_summary(sub)})
    return JsonResponse({"ok": True, "id": sub.id})


# ── clean (data workbench) ───────────────────────────────────────────

@login_required
def data(request, code):
    from .models import CleaningRun  # lazy: avoids widening the module import block

    survey = _own(request, code)
    schema = (survey.current_version.schema if survey.current_version
              else survey.draft_schema) or {}

    # Saved cleaning pipelines (basic ones made here or advanced ones from
    # the studio) so the classic data page can list, run and reuse them.
    latest_runs = {}
    for r in (CleaningRun.objects
              .filter(pipeline__survey=survey, status="complete")
              .order_by("pipeline_id", "-completed_at", "-id")):
        latest_runs.setdefault(r.pipeline_id, r)
    pipelines = [{
        "id": p.id,
        "name": p.name,
        "description": p.description,
        "is_active": p.is_active,
        "step_count": p.steps.count(),
        "updated_at": p.updated_at.isoformat(),
        "latest_run": ({
            "id": latest_runs[p.id].id,
            "result_count": latest_runs[p.id].result_count,
            "column_count": latest_runs[p.id].column_count,
            "completed_at": (latest_runs[p.id].completed_at.isoformat()
                             if latest_runs[p.id].completed_at else None),
        } if p.id in latest_runs else None),
    } for p in survey.pipelines.all()]

    columns = [q["name"] for q in schema.get("questions", [])
               if q.get("name") and q.get("type") != "section"]

    return render(request, "kura/data.html", {
        "survey": survey,
        "schema_json": json.dumps(schema),
        "columns_json": json.dumps(columns),
        "pipelines_json": json.dumps(pipelines),
        "rules_json": json.dumps([
            {"id": r.id, "name": r.name, "kind": r.kind, "action": r.action,
             "config": r.config, "enabled": r.enabled}
            for r in survey.cleaning_rules.all()
        ]),
    })


@login_required
@require_GET
def data_rows(request, code):
    survey = _own(request, code)
    subs = survey.submissions.select_related("form_version", "device").prefetch_related("flags")
    return JsonResponse({"ok": True, "rows": [s.as_dict() for s in subs]})


@login_required
@require_POST
def edit_answer(request, code):
    survey = _own(request, code)
    data = _body(request) or {}
    sub = get_object_or_404(Submission, id=data.get("id"), survey=survey)
    field = str(data.get("field") or "").strip()
    if not field:
        return JsonResponse({"ok": False, "error": "field is required"}, status=400)
    old = sub.answers.get(field)
    new = data.get("value")
    sub.answers[field] = new
    sub.save(update_fields=["answers"])
    AnswerEdit.objects.create(
        submission=sub, field=field, old_value=old, new_value=new,
        reason=str(data.get("reason") or "manual edit")[:200],
        edited_by=request.user,
    )
    return JsonResponse({"ok": True})


@login_required
@require_POST
def set_row_status(request, code):
    survey = _own(request, code)
    data = _body(request) or {}
    sub = get_object_or_404(Submission, id=data.get("id"), survey=survey)
    status = data.get("status")
    if status not in ("complete", "partial", "flagged", "excluded"):
        return JsonResponse({"ok": False, "error": "bad status"}, status=400)
    sub.status = status
    sub.save(update_fields=["status"])
    if status == "complete":
        sub.flags.filter(resolved=False).update(resolved=True)
    return JsonResponse({"ok": True})


@login_required
@require_POST
def rules_save(request, code):
    survey = _own(request, code)
    data = _body(request) or {}
    rules = data.get("rules")
    if not isinstance(rules, list):
        return JsonResponse({"ok": False, "error": "rules must be a list"}, status=400)
    keep = []
    for r in rules:
        rid = r.get("id")
        fields = {
            "name": str(r.get("name") or "Rule")[:80],
            "kind": r.get("kind") if r.get("kind") in dict(CleaningRule.KIND_CHOICES) else "logic",
            "action": r.get("action") if r.get("action") in ("flag", "exclude", "recode") else "flag",
            "config": r.get("config") if isinstance(r.get("config"), dict) else {},
            "enabled": bool(r.get("enabled", True)),
        }
        if rid:
            survey.cleaning_rules.filter(id=rid).update(**fields)
            keep.append(rid)
        else:
            keep.append(CleaningRule.objects.create(survey=survey, **fields).id)
    survey.cleaning_rules.exclude(id__in=keep).delete()
    return JsonResponse({"ok": True, "ids": keep})


@login_required
@require_POST
def run_cleaning(request, code):
    survey = _own(request, code)
    summary = run_rules(survey, user=request.user)
    return JsonResponse({"ok": True, "summary": summary})


@login_required
@require_POST
def data_purge(request, code):
    """Delete every submission (and derived data) so the form starts fresh.

    Destructive and irreversible, so it demands the survey code typed back
    as confirmation: POST JSON {"confirm": "<CODE>"}.

    Removed:  submissions (flags + answer edits cascade), cleaning RUNS
              (cleaned records + change logs cascade), sync logs.
    Kept:     the form itself, published versions, cleaning rules, saved
              cleaning PIPELINES (they are reusable definitions), lookup
              datasets and device registrations/access decisions.
    """
    from django.db import transaction

    from .models import CleaningRun

    survey = _own(request, code)
    data = _body(request) or {}
    confirm = str(data.get("confirm") or "").strip().upper()
    if confirm != survey.code:
        return JsonResponse({
            "ok": False,
            "error": "Type the survey code to confirm deletion.",
        }, status=400)

    with transaction.atomic():
        sub_count = survey.submissions.count()
        run_count = CleaningRun.objects.filter(pipeline__survey=survey).count()
        # Flags, edits, cleaned records and change logs all cascade.
        survey.submissions.all().delete()
        CleaningRun.objects.filter(pipeline__survey=survey).delete()
        sync_count, _ = SyncLog.objects.filter(survey=survey).delete()

    return JsonResponse({
        "ok": True,
        "deleted": {
            "submissions": sub_count,
            "cleaning_runs": run_count,
            "sync_logs": sync_count,
        },
    })


@login_required
@require_GET
def export_csv(request, code):
    survey = _own(request, code)
    schema = (survey.current_version.schema if survey.current_version
              else survey.draft_schema) or {}
    names = [q["name"] for q in schema.get("questions", [])
             if q.get("name") and q.get("type") != "section"]

    response = HttpResponse(content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="{survey.code}_data.csv"'
    writer = csv.writer(response)
    writer.writerow(["uuid", "status", "source", "version", "received_at",
                     "duration_s", "score", "gps_lat", "gps_lng"] + names)
    include_excluded = request.GET.get("all") == "1"
    subs = survey.submissions.all()
    if not include_excluded:
        subs = subs.exclude(status="excluded")
    for s in subs:
        row = [
            s.client_uuid, s.status, s.source,
            s.form_version.version if s.form_version else "",
            s.received_at.isoformat(), round(s.duration_ms / 1000, 1),
            s.score if s.score is not None else "",
            s.gps_lat if s.gps_lat is not None else "",
            s.gps_lng if s.gps_lng is not None else "",
        ]
        merged = {**s.answers, **s.calculations}
        for n in names:
            v = merged.get(n)
            if isinstance(v, list) and v and isinstance(v[0], dict):
                row.append(json.dumps(v, ensure_ascii=False))   # repeat group
            elif isinstance(v, list):
                row.append("|".join(str(x) for x in v))
            else:
                row.append("" if v is None else v)
        writer.writerow(row)
    return response


# ── share QR codes ───────────────────────────────────────────────────

def _share_links(request, survey):
    """The two things a survey QR can encode.

    web → the public runner URL: scan with any phone camera, the form
          opens in the browser (scan & collect).
    app → a kura:// deep link carrying host + code: scan from inside
          Kura Collect's scanner, the app calls the sync API, downloads
          the form and collects offline (scan & download form & collect).
    """
    return {
        "web": request.build_absolute_uri(f"/kura/{survey.code}/"),
        "app": f"kura://form?host={request.get_host()}&code={survey.code}",
    }


@login_required
@require_GET
def qr_code(request, code):
    """PNG QR code for the survey (owner-only).

    GET params:
        variant=web|app   what to encode (default: web — see _share_links)
        download=1        serve as an attachment instead of inline
        scale=4..40       pixels per QR module (default 12 ≈ 600 px,
                          crisp enough for an A4 poster)
    """
    try:
        import segno  # pure-Python, no Pillow needed: pip install segno
    except ImportError:
        return JsonResponse(
            {"ok": False,
             "error": "QR support is not installed — run: pip install segno"},
            status=500)

    survey = _own(request, code)
    links = _share_links(request, survey)
    variant = request.GET.get("variant") or "web"
    if variant not in links:
        variant = "web"

    try:
        scale = min(40, max(4, int(request.GET.get("scale", 12))))
    except (TypeError, ValueError):
        scale = 12

    buf = io.BytesIO()
    # error="q" (~25 % recovery) survives print smudges and phone glare.
    segno.make(links[variant], error="q").save(
        buf, kind="png", scale=scale, border=2,
        dark="#0b0d26", light="#ffffff")

    response = HttpResponse(buf.getvalue(), content_type="image/png")
    if request.GET.get("download"):
        response["Content-Disposition"] = (
            f'attachment; filename="{survey.code}_qr_{variant}.png"')
    else:
        response["Content-Disposition"] = (
            f'inline; filename="{survey.code}_qr_{variant}.png"')
    return response


# ── live monitor (where is data coming from?) ────────────────────────

@login_required
def monitor(request, code):
    survey = _own(request, code)
    links = _share_links(request, survey)
    return render(request, "kura/monitor.html", {
        "survey": survey,
        "feed_url": f"/kura/{survey.code}/monitor/feed/",
        "collect_url": links["web"],
        "app_link": links["app"],
    })


@login_required
def live_map(request, code):
    """Full-screen, projector-friendly live map of incoming responses."""
    survey = _own(request, code)
    return render(request, "kura/map.html", {
        "survey": survey,
        "feed_url": f"/kura/{survey.code}/monitor/feed/",
    })


@login_required
@require_POST
def device_access_update(request, code):
    """Update the survey policy or allow/block/reset one registered device."""
    survey = _own(request, code)
    data = _body(request)
    if data is None:
        data = request.POST

    policy = str(
        data.get("policy")
        or data.get("device_policy")
        or data.get("mode")
        or ""
    ).strip().lower()

    if policy:
        valid_policies = {choice[0] for choice in Survey.DEVICE_POLICY_CHOICES}
        if policy not in valid_policies:
            return JsonResponse({
                "ok": False,
                "error": "Policy must be allow_all, manual, or block_all.",
            }, status=400)

        survey.device_policy = policy
        survey.save(update_fields=["device_policy", "updated_at"])

    device_id = data.get("device_id")
    action = str(data.get("action") or "").strip().lower()

    # Backward compatibility with the earlier monitor JavaScript, which sent
    # {"allow": true} or {"allow": false}.
    if not action and "allow" in data:
        allow_raw = data.get("allow")
        should_allow = (
            allow_raw is True
            or str(allow_raw).strip().lower() in {"1", "true", "yes", "allow"}
        )
        action = "allow" if should_allow else "block"

    access_status = None
    allowed = None

    if device_id not in (None, ""):
        try:
            device = Device.objects.select_related("user").get(pk=int(device_id))
        except (Device.DoesNotExist, TypeError, ValueError):
            return JsonResponse({
                "ok": False,
                "error": "Device not found.",
            }, status=404)

        # A survey owner may manage their own registered devices and devices
        # that have requested/accessed or submitted to this survey.
        belongs = (
            device.user_id == survey.owner_id
            or SurveyDeviceAccess.objects.filter(
                survey=survey,
                device=device,
            ).exists()
            or device.submissions.filter(survey=survey).exists()
        )
        if not belongs:
            raise Http404

        if action not in {"allow", "block", "pending"}:
            return JsonResponse({
                "ok": False,
                "error": "Action must be allow, block, or pending.",
            }, status=400)

        access, _created = SurveyDeviceAccess.objects.get_or_create(
            survey=survey,
            device=device,
            defaults={"allowed": False},
        )

        if action == "allow":
            access.allow(request.user)
            access_status = "allowed"
        elif action == "block":
            access.block(request.user)
            access_status = "blocked"
        else:
            access.mark_pending()
            access_status = "pending"

        allowed = access.allowed

    return JsonResponse({
        "ok": True,
        "device_policy": survey.device_policy,
        "mode": survey.device_policy,
        "device_id": int(device_id) if device_id not in (None, "") else None,
        "action": action or None,
        "allowed": allowed,
        "access_status": access_status,
    })


@login_required
@require_GET
def monitor_feed(request, code):
    """Snapshot + incremental feed for the monitor page.

    ?since=<ISO datetime>  → only submissions received after that instant
    (the page polls with this when the WebSocket isn't available). Without
    ?since it returns the latest 200 as the initial snapshot, plus device
    and sync-history panels and per-source totals.
    """
    from django.db.models import Count, Max, Q

    survey = _own(request, code)
    now = timezone.now()

    subs = survey.submissions.select_related("form_version", "device", "enumerator")
    # '+00:00' in an unencoded query string decodes to ' 00:00' — repair it
    # so clients that forget encodeURIComponent still get increments.
    raw_since = (request.GET.get("since") or "").strip()
    since = parse_datetime(raw_since) or parse_datetime(raw_since.replace(" ", "+"))
    incremental = since is not None
    if incremental:
        subs = subs.filter(received_at__gt=since)
    subs = list(subs.order_by("-received_at")[:200])

    payload = {
        "ok": True,
        "now": now.isoformat(),
        "submissions": [submission_summary(s) for s in subs],
    }

    if not incremental:
        base = survey.submissions
        payload["totals"] = {
            "total": base.count(),
            "web": base.filter(source="web").count(),
            "api": base.filter(source="api").count(),
            "with_gps": base.filter(gps_lat__isnull=False).count(),
            "last_hour": base.filter(received_at__gte=now - timedelta(hours=1)).count(),
            "today": base.filter(received_at__date=now.date()).count(),
        }
        # Devices that have ever pushed to this survey, plus every device
        # registered by the owner (so a phone shows up before its first sync).
        devices = (
            Device.objects.filter(
                Q(user=survey.owner) | Q(submissions__survey=survey)
            )
            .distinct()
            .annotate(
                pushed=Count("submissions", filter=Q(submissions__survey=survey)),
                last_push=Max("submissions__received_at",
                              filter=Q(submissions__survey=survey)),
            )
        )
        access_rows = {
            row.device_id: row
            for row in SurveyDeviceAccess.objects.filter(
                survey=survey,
                device__in=devices,
            )
        }

        payload["device_policy"] = survey.device_policy
        # Backward-compatible key used by the current monitor template.
        payload["device_access_mode"] = survey.device_policy
        payload["devices"] = []

        for d in devices:
            access = access_rows.get(d.id)

            if survey.device_policy == "block_all":
                can_submit = False
                access_status = "blocked"
            elif access is not None:
                can_submit = bool(d.is_active and access.allowed)
                if access.allowed:
                    access_status = "allowed"
                elif access.decided_at is None:
                    access_status = "pending"
                else:
                    access_status = "blocked"
            elif survey.device_policy == "allow_all":
                can_submit = bool(d.is_active)
                access_status = "allowed" if d.is_active else "blocked"
            else:
                can_submit = False
                access_status = "not_requested"

            payload["devices"].append({
                "id": d.id,
                "name": d.name,
                "platform": d.platform,
                "enumerator": d.user.get_username(),
                "active": d.is_active,
                "explicit_access": access.allowed if access is not None else None,
                "allowed": can_submit,
                # Backward-compatible key used by the current monitor template.
                "can_submit": can_submit,
                "access_status": access_status,
                "requested_at": (
                    access.requested_at.isoformat()
                    if access is not None and access.requested_at
                    else None
                ),
                "decided_at": (
                    access.decided_at.isoformat()
                    if access is not None and access.decided_at
                    else None
                ),
                "pushed": d.pushed,
                "last_seen": d.last_seen.isoformat() if d.last_seen else None,
                "last_push": d.last_push.isoformat() if d.last_push else None,
            })
        payload["syncs"] = [{
            "device": log.device.name,
            "enumerator": log.device.user.get_username(),
            "pushed": log.pushed,
            "duplicates": log.duplicates,
            "rejected": log.rejected,
            "at": log.created_at.isoformat(),
        } for log in SyncLog.objects.filter(survey=survey)
                                    .select_related("device", "device__user")[:50]]

    return JsonResponse(payload)


# ── present (bridge to Hanns) ────────────────────────────────────────

@login_required
@require_POST
def export_hanns(request, code):
    survey = _own(request, code)
    try:
        from .hanns_export import build_results_deck
        deck = build_results_deck(survey, request.user)
    except ImportError:
        return JsonResponse({"ok": False, "error": "The Hanns app is not installed."}, status=500)
    return JsonResponse({
        "ok": True,
        "deck_code": deck.code,
        "edit_url": f"/hanns/{deck.code}/edit/",
        "present_url": f"/hanns/{deck.code}/present/",
    })


# ── lookup datasets (scan-to-search / follow-up) ─────────────────────

@login_required
@require_POST
def lookups_upload(request, code):
    """Upload a CSV as a lookup dataset (owner-only, multipart form).

    Fields: file (CSV, first row = headers), name (optional, defaults to
    the file name), key_column (optional, defaults to the first header).
    Re-uploading with the same name replaces the dataset.
    """
    import csv
    import io

    survey = _own(request, code)
    f = request.FILES.get("file")
    if not f:
        return JsonResponse({"ok": False, "error": "No file uploaded."}, status=400)
    if f.size > 8 * 1024 * 1024:
        return JsonResponse({"ok": False, "error": "CSV too large (8 MB max)."}, status=413)
    try:
        text = f.read().decode("utf-8-sig", errors="replace")
        reader = csv.reader(io.StringIO(text))
        rows_raw = [r for r in reader if any(c.strip() for c in r)]
    except Exception:
        return JsonResponse({"ok": False, "error": "Could not parse the CSV."}, status=400)
    if len(rows_raw) < 2:
        return JsonResponse({"ok": False, "error": "CSV needs a header row and at least one data row."}, status=400)

    headers = [h.strip() for h in rows_raw[0]]
    if len(set(headers)) != len(headers) or not all(headers):
        return JsonResponse({"ok": False, "error": "Headers must be unique and non-empty."}, status=400)

    key_column = (request.POST.get("key_column") or headers[0]).strip()
    if key_column not in headers:
        return JsonResponse({"ok": False, "error": f"Key column “{key_column}” not in the CSV."}, status=400)

    data_rows = rows_raw[1:21000]
    if len(rows_raw) - 1 > 20000:
        return JsonResponse({"ok": False, "error": "Too many rows (20,000 max)."}, status=413)
    rows = [{h: (r[i].strip() if i < len(r) else "") for i, h in enumerate(headers)}
            for r in data_rows]

    name = (request.POST.get("name") or f.name.rsplit(".", 1)[0])[:80].strip() or "dataset"
    ds, _created = LookupDataset.objects.update_or_create(
        survey=survey, name=name,
        defaults={"key_column": key_column, "columns": headers, "rows": rows})
    return JsonResponse({"ok": True, "dataset": {
        "id": ds.id, "name": ds.name, "key_column": ds.key_column,
        "columns": ds.columns, "rows": len(ds.rows)}})


@login_required
@require_POST
def lookup_delete(request, code, pk):
    survey = _own(request, code)
    LookupDataset.objects.filter(survey=survey, pk=pk).delete()
    return JsonResponse({"ok": True})


def lookup_query(request, code):
    """Exact-match lookup for the runner (public while collecting;
    the owner can always query it, e.g. from the preview).

    GET ?ds=<dataset id>&q=<scanned/typed value> →
        {ok, found, row, columns, key_column}
    Only an exact (case-insensitive) key match is returned — the endpoint
    never lists or searches rows, so the dataset can't be browsed."""
    survey = get_object_or_404(Survey, code=code.upper())
    is_owner = request.user.is_authenticated and survey.owner_id == request.user.id
    if not (survey.is_open or is_owner):
        return JsonResponse({"ok": False, "error": "Survey is not collecting."}, status=409)
    try:
        ds = LookupDataset.objects.get(survey=survey, pk=int(request.GET.get("ds", 0)))
    except (LookupDataset.DoesNotExist, ValueError, TypeError):
        return JsonResponse({"ok": False, "error": "Unknown dataset."}, status=404)
    q = (request.GET.get("q") or "").strip()
    if not q:
        return JsonResponse({"ok": True, "found": False})
    key = ds.key_column
    q_low = q.lower()
    row = next((r for r in ds.rows
                if str(r.get(key, "")).strip().lower() == q_low), None)
    return JsonResponse({"ok": True, "found": row is not None, "row": row,
                         "columns": ds.columns, "key_column": key})