"""HTTP endpoints for Kura's visual cleaning pipeline and analytics studio."""

from __future__ import annotations

import json

from django.contrib.auth.decorators import login_required
from django.db import transaction
from django.http import Http404, JsonResponse
from django.shortcuts import get_object_or_404, render
from django.views.decorators.http import require_GET, require_POST

from .analytics import dashboard_payload
from .models import (
    CleaningPipeline,
    CleaningRun,
    PipelineStep,
    Survey,
)
from .pipeline_engine import PipelineExecutor
from .report_export import (
    export_clean_csv,
    export_clean_excel,
    export_excel,
    export_html,
    export_pdf,
    export_word,
)


def _own(request, code):
    survey = get_object_or_404(Survey, code=code.upper())
    if survey.owner_id != request.user.id:
        raise Http404
    return survey


def _json(request):
    try:
        return json.loads(request.body.decode("utf-8") or "{}")
    except (ValueError, UnicodeDecodeError):
        return None


def _pipeline_payload(pipeline, with_steps=True):
    latest = pipeline.runs.filter(status="complete").order_by("-completed_at", "-id").first()
    payload = {
        "id": pipeline.id,
        "name": pipeline.name,
        "description": pipeline.description,
        "is_active": pipeline.is_active,
        "step_count": pipeline.steps.count(),
        "updated_at": pipeline.updated_at.isoformat(),
        "latest_run": {
            "id": latest.id,
            "result_count": latest.result_count,
            "column_count": latest.column_count,
            "completed_at": latest.completed_at.isoformat() if latest.completed_at else None,
        } if latest else None,
    }
    if with_steps:
        payload["steps"] = [
            {
                "id": s.id,
                "order": s.order,
                "operation": s.operation,
                "name": s.name,
                "config": s.config,
                "enabled": s.enabled,
                "stop_on_error": s.stop_on_error,
                "note": s.note,
            }
            for s in pipeline.steps.order_by("order", "id")
        ]
    return payload


@login_required
def studio(request, code):
    survey = _own(request, code)
    pipeline = None
    # ?pipeline=<id> lets the data page (and bookmarks) open a specific
    # saved pipeline directly in the studio.
    requested = request.GET.get("pipeline")
    if requested:
        try:
            pipeline = survey.pipelines.filter(id=int(requested)).first()
        except (TypeError, ValueError):
            pipeline = None
    if pipeline is None:
        pipeline = survey.pipelines.order_by("-is_active", "-updated_at").first()
    if pipeline is None:
        pipeline = CleaningPipeline.objects.create(
            survey=survey,
            name="Main cleaning pipeline",
            created_by=request.user,
        )
    schema = (
        survey.current_version.schema
        if survey.current_version else survey.draft_schema
    ) or {}
    columns = [
        q.get("name") for q in schema.get("questions", [])
        if q.get("name") and q.get("type") != "section"
    ]
    return render(request, "kura/data_studio.html", {
        "survey": survey,
        "pipeline_json": json.dumps(_pipeline_payload(pipeline)),
        "columns_json": json.dumps(columns),
        "operations_json": json.dumps([
            {"value": value, "label": label}
            for value, label in PipelineStep.OPERATION_CHOICES
        ]),
    })


@login_required
@require_GET
def studio_bootstrap(request, code):
    survey = _own(request, code)
    pipelines = [
        _pipeline_payload(p)
        for p in survey.pipelines.prefetch_related("steps")
    ]
    runs = [
        {
            "id": r.id,
            "pipeline_id": r.pipeline_id,
            "pipeline_name": r.pipeline.name,
            "label": r.label,
            "status": r.status,
            "source_count": r.source_count,
            "result_count": r.result_count,
            "excluded_count": r.excluded_count,
            "column_count": r.column_count,
            "summary": r.summary,
            "error": r.error,
            "started_at": r.started_at.isoformat(),
            "completed_at": r.completed_at.isoformat() if r.completed_at else None,
        }
        for r in CleaningRun.objects.filter(pipeline__survey=survey).select_related("pipeline")[:30]
    ]
    raw_rows = [
        s.as_dict()
        for s in survey.submissions.select_related("form_version", "device")[:500]
    ]
    return JsonResponse({
        "ok": True,
        "pipelines": pipelines,
        "runs": runs,
        "raw_rows": raw_rows,
    })


@login_required
@require_GET
def pipeline_list(request, code):
    """Lightweight pipeline listing for the classic data page."""
    survey = _own(request, code)
    return JsonResponse({
        "ok": True,
        "pipelines": [
            _pipeline_payload(p, with_steps=False)
            for p in survey.pipelines.all()
        ],
    })


@login_required
@require_POST
def pipeline_save(request, code):
    survey = _own(request, code)
    data = _json(request)
    if data is None:
        return JsonResponse({"ok": False, "error": "JSON body required."}, status=400)

    pipeline_id = data.get("id")
    if pipeline_id:
        pipeline = get_object_or_404(CleaningPipeline, id=pipeline_id, survey=survey)
    else:
        pipeline = CleaningPipeline(survey=survey, created_by=request.user)

    pipeline.name = str(data.get("name") or "Cleaning pipeline")[:140]
    pipeline.description = str(data.get("description") or "")
    pipeline.is_active = bool(data.get("is_active", True))
    pipeline.save()

    steps = data.get("steps")
    if not isinstance(steps, list):
        return JsonResponse({"ok": False, "error": "steps must be a list."}, status=400)

    valid_ops = dict(PipelineStep.OPERATION_CHOICES)
    with transaction.atomic():
        pipeline.steps.all().delete()
        objects = []
        for index, item in enumerate(steps):
            operation = item.get("operation")
            if operation not in valid_ops:
                return JsonResponse({
                    "ok": False,
                    "error": f"Unsupported operation: {operation}",
                }, status=400)
            objects.append(PipelineStep(
                pipeline=pipeline,
                order=index,
                operation=operation,
                name=str(item.get("name") or valid_ops[operation])[:140],
                config=item.get("config") if isinstance(item.get("config"), dict) else {},
                enabled=bool(item.get("enabled", True)),
                stop_on_error=bool(item.get("stop_on_error", True)),
                note=str(item.get("note") or ""),
            ))
        PipelineStep.objects.bulk_create(objects)

    pipeline.refresh_from_db()
    return JsonResponse({"ok": True, "pipeline": _pipeline_payload(pipeline)})


@login_required
@require_POST
def pipeline_duplicate(request, code, pipeline_id):
    """Clone a saved pipeline (steps included) so it can be adapted safely."""
    survey = _own(request, code)
    source = get_object_or_404(CleaningPipeline, id=pipeline_id, survey=survey)
    with transaction.atomic():
        clone = CleaningPipeline.objects.create(
            survey=survey,
            name=f"{source.name} (copy)"[:140],
            description=source.description,
            is_active=False,
            created_by=request.user,
        )
        PipelineStep.objects.bulk_create([
            PipelineStep(
                pipeline=clone,
                order=s.order,
                operation=s.operation,
                name=s.name,
                config=s.config,
                enabled=s.enabled,
                stop_on_error=s.stop_on_error,
                note=s.note,
            )
            for s in source.steps.order_by("order", "id")
        ])
    return JsonResponse({"ok": True, "pipeline": _pipeline_payload(clone)})


@login_required
@require_POST
def pipeline_delete(request, code, pipeline_id):
    """Delete a saved pipeline and its runs (raw submissions are untouched)."""
    survey = _own(request, code)
    pipeline = get_object_or_404(CleaningPipeline, id=pipeline_id, survey=survey)
    pipeline.delete()
    return JsonResponse({"ok": True})


@login_required
@require_POST
def pipeline_run(request, code, pipeline_id):
    survey = _own(request, code)
    pipeline = get_object_or_404(CleaningPipeline, id=pipeline_id, survey=survey)
    data = _json(request) or {}
    run = CleaningRun.objects.create(
        pipeline=pipeline,
        label=str(data.get("label") or "")[:140],
        run_by=request.user,
    )
    try:
        PipelineExecutor(run).execute()
    except Exception as exc:
        return JsonResponse({
            "ok": False,
            "run_id": run.id,
            "error": str(exc),
        }, status=422)
    return JsonResponse({
        "ok": True,
        "run_id": run.id,
        "status": run.status,
        "summary": run.summary,
        "result_count": run.result_count,
        "column_count": run.column_count,
    })


@login_required
@require_GET
def run_rows(request, code, run_id):
    survey = _own(request, code)
    run = get_object_or_404(CleaningRun, id=run_id, pipeline__survey=survey)
    limit = min(2000, max(1, int(request.GET.get("limit", 500))))
    rows = [
        {
            "id": r.id,
            "row_number": r.row_number,
            "source_submission_id": r.source_submission_id,
            "excluded": r.excluded,
            "data": r.data,
        }
        for r in run.records.order_by("row_number")[:limit]
    ]
    changes = {}
    for change in run.changes.order_by("id")[:10000]:
        key = f"{change.row_number}:{change.field}"
        changes.setdefault(key, []).append({
            "type": change.change_type,
            "old": change.old_value,
            "new": change.new_value,
            "detail": change.detail,
            "step": change.step.name if change.step_id else None,
        })
    return JsonResponse({
        "ok": True,
        "run": {
            "id": run.id,
            "status": run.status,
            "result_count": run.result_count,
            "column_count": run.column_count,
            "summary": run.summary,
        },
        "rows": rows,
        "changes": changes,
    })


@login_required
@require_POST
def run_dashboard(request, code, run_id):
    survey = _own(request, code)
    run = get_object_or_404(CleaningRun, id=run_id, pipeline__survey=survey, status="complete")
    data = _json(request) or {}
    dependent = data.get("dependent")
    independent = data.get("independent") or []
    return JsonResponse({
        "ok": True,
        "dashboard": dashboard_payload(run, dependent, independent),
    })


@login_required
@require_GET
def run_export(request, code, run_id, fmt):
    survey = _own(request, code)
    run = get_object_or_404(CleaningRun, id=run_id, pipeline__survey=survey, status="complete")
    exporters = {
        # Full report exports (steps, stats, audit trail)
        "xlsx": export_excel,
        "docx": export_word,
        "pdf": export_pdf,
        "html": export_html,
        # Clean-data-only downloads
        "csv": export_clean_csv,
        "data-xlsx": export_clean_excel,
    }
    exporter = exporters.get(fmt)
    if exporter is None:
        return JsonResponse({"ok": False, "error": "Unsupported format."}, status=400)
    try:
        return exporter(run)
    except RuntimeError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=501)