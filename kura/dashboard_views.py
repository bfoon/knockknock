"""
kura/dashboard_views.py — endpoints for the live dashboard builder.

Access model
------------
Editing is owner-or-editor. Viewing is owner, any collaborator, or — only
when the owner has explicitly switched it on — anyone holding the share
link. The share link is deliberately a separate, rotatable token rather
than the survey code: the survey code is printed on QR posters and handed
to enumerators, and it must never become a key to the results screen.
"""

from __future__ import annotations

import json

from django.contrib.auth.decorators import login_required
from django.http import Http404, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.views.decorators.http import require_GET, require_POST

from .dashboard_engine import dashboard_payload, field_catalogue
from .models import CleaningRun, Survey
from .models_dashboard import DashboardTile, LiveDashboard

VALID_KINDS = {k for k, _ in DashboardTile.KIND_CHOICES}
MAX_TILES = 40


# ─────────────────────────────────────────────────────────────────────
#  Access helpers
# ─────────────────────────────────────────────────────────────────────

def _survey(request, code, need="view"):
    survey = get_object_or_404(Survey, code=code.upper())
    user = request.user
    if not user.is_authenticated:
        raise Http404
    if survey.owner_id == user.id:
        return survey
    collab = survey.collaborators.filter(user=user).first()
    if collab is None:
        raise Http404
    if need == "edit" and collab.role not in ("editor", "analyst"):
        raise Http404
    return survey


def _json(request):
    try:
        return json.loads(request.body.decode("utf-8") or "{}")
    except (ValueError, UnicodeDecodeError):
        return None


def _schema(survey):
    return (survey.current_version.schema
            if survey.current_version else survey.draft_schema) or {}


def _resolve_source(dashboard, survey, data):
    """Apply a source change, validating the referenced object belongs here."""
    source = data.get("source") or "submissions"
    dashboard.pipeline = dashboard.dataset = dashboard.run = None

    if source == "pipeline":
        pipeline = survey.pipelines.filter(id=data.get("pipeline_id")).first()
        if pipeline is None:
            return "That pipeline no longer exists."
        dashboard.pipeline = pipeline
    elif source == "dataset":
        dataset = survey.datasets.filter(id=data.get("dataset_id")).first()
        if dataset is None:
            return "That uploaded file no longer exists."
        dashboard.dataset = dataset
    elif source == "run":
        run = CleaningRun.objects.filter(
            id=data.get("run_id"), pipeline__survey=survey, status="complete",
        ).first()
        if run is None:
            return "That run no longer exists."
        dashboard.run = run
    elif source != "submissions":
        return f"Unknown source '{source}'."

    dashboard.source = source
    return None


# ─────────────────────────────────────────────────────────────────────
#  Pages
# ─────────────────────────────────────────────────────────────────────

@login_required
def dashboard_list(request, code):
    """No dashboards yet? Go straight to a new one — nobody wants an empty list."""
    survey = _survey(request, code)
    first = survey.live_dashboards.first()
    if first is None:
        first = LiveDashboard.objects.create(
            survey=survey, name="Live dashboard", created_by=request.user,
        )
    return redirect(reverse("kura:dashboard", args=[survey.code, first.id]))


@login_required
def dashboard(request, code, dashboard_id):
    survey = _survey(request, code)
    board = get_object_or_404(LiveDashboard, id=dashboard_id, survey=survey)
    return render(request, "kura/live_dashboard.html", {
        "survey": survey,
        "board": board,
        "can_edit": True,
        "public": False,
        "bootstrap_json": json.dumps({
            "dashboard": board.as_dict(),
            "dashboards": [
                {"id": d.id, "name": d.name} for d in survey.live_dashboards.all()
            ],
            "pipelines": [
                {"id": p.id, "name": p.name, "steps": p.steps.count()}
                for p in survey.pipelines.all()
            ],
            "datasets": [
                {"id": d.id, "name": d.name, "rows": d.row_count}
                for d in survey.datasets.all()
            ],
            "runs": [
                {"id": r.id, "label": r.label or f"Run #{r.id}",
                 "pipeline": r.pipeline.name, "rows": r.result_count}
                for r in CleaningRun.objects.filter(
                    pipeline__survey=survey, status="complete")[:20]
            ],
        }),
    })


def public_dashboard(request, token):
    """Read-only board behind a rotatable share token — the projector view."""
    board = get_object_or_404(LiveDashboard, public_token=token, is_public=True)
    return render(request, "kura/live_dashboard.html", {
        "survey": board.survey,
        "board": board,
        "can_edit": False,
        "public": True,
        "bootstrap_json": json.dumps({
            "dashboard": board.as_dict(),
            "dashboards": [], "pipelines": [], "datasets": [], "runs": [],
        }),
    })


# ─────────────────────────────────────────────────────────────────────
#  Data
# ─────────────────────────────────────────────────────────────────────

@login_required
@require_GET
def dashboard_data(request, code, dashboard_id):
    survey = _survey(request, code)
    board = get_object_or_404(LiveDashboard, id=dashboard_id, survey=survey)
    return JsonResponse(_data_response(request, board))


@require_GET
def public_dashboard_data(request, token):
    board = get_object_or_404(LiveDashboard, public_token=token, is_public=True)
    return JsonResponse(_data_response(request, board))


def _data_response(request, board):
    tile_ids = None
    raw = request.GET.get("tiles")
    if raw:
        tile_ids = [int(v) for v in raw.split(",") if v.strip().isdigit()]

    # ?since=<stamp> lets a polling client skip the whole computation when
    # nothing has arrived. Twenty idle browsers then cost two DB aggregates
    # each, not twenty full passes over the data.
    payload = dashboard_payload(
        board,
        schema=_schema(board.survey),
        tile_ids=tile_ids,
        use_cache=request.GET.get("fresh") != "1",
    )
    since = request.GET.get("since")
    if since and since == payload["stamp"] and not tile_ids:
        return {"ok": True, "unchanged": True, "stamp": payload["stamp"],
                "pulse": payload["pulse"], "generated_at": payload["generated_at"]}
    return payload


@login_required
@require_GET
def dashboard_fields(request, code, dashboard_id):
    survey = _survey(request, code)
    board = get_object_or_404(LiveDashboard, id=dashboard_id, survey=survey)
    return JsonResponse({"ok": True, **field_catalogue(board, _schema(survey))})


# ─────────────────────────────────────────────────────────────────────
#  Editing
# ─────────────────────────────────────────────────────────────────────

@login_required
@require_POST
def dashboard_create(request, code):
    survey = _survey(request, code, need="edit")
    data = _json(request) or {}
    board = LiveDashboard(survey=survey, created_by=request.user,
                          name=str(data.get("name") or "Live dashboard")[:140])
    error = _resolve_source(board, survey, data)
    if error:
        return JsonResponse({"ok": False, "error": error}, status=400)
    board.save()
    return JsonResponse({"ok": True, "dashboard": board.as_dict()})


@login_required
@require_POST
def dashboard_save(request, code, dashboard_id):
    """Save board settings and the full tile set in one transaction-shaped call.

    Tiles are replaced wholesale rather than diffed: the client owns the
    layout, the payload is small, and a partial save that leaves a board
    half-old and half-new is the one failure mode an ops screen cannot have.
    """
    survey = _survey(request, code, need="edit")
    board = get_object_or_404(LiveDashboard, id=dashboard_id, survey=survey)
    data = _json(request)
    if data is None:
        return JsonResponse({"ok": False, "error": "JSON body required."}, status=400)

    if "name" in data:
        board.name = str(data["name"] or "Live dashboard")[:140]
    if "description" in data:
        board.description = str(data["description"] or "")
    if "source" in data:
        error = _resolve_source(board, survey, data)
        if error:
            return JsonResponse({"ok": False, "error": error}, status=400)
    if "filters" in data and isinstance(data["filters"], list):
        board.filters = data["filters"][:20]
    if "filter_match" in data:
        board.filter_match = "any" if data["filter_match"] == "any" else "all"
    if "theme" in data:
        board.theme = data["theme"] if data["theme"] in dict(
            LiveDashboard.THEME_CHOICES) else "studio"
    if "refresh_seconds" in data:
        try:
            board.refresh_seconds = max(0, min(3600, int(data["refresh_seconds"])))
        except (TypeError, ValueError):
            pass
    if "is_live" in data:
        board.is_live = bool(data["is_live"])
    if "is_public" in data:
        board.is_public = bool(data["is_public"])
    if "include_excluded" in data:
        board.include_excluded = bool(data["include_excluded"])
    board.save()

    tiles = data.get("tiles")
    if isinstance(tiles, list):
        if len(tiles) > MAX_TILES:
            return JsonResponse(
                {"ok": False, "error": f"A board holds at most {MAX_TILES} cards."},
                status=400)
        kept = []
        for index, item in enumerate(tiles):
            kind = item.get("kind")
            if kind not in VALID_KINDS:
                return JsonResponse(
                    {"ok": False, "error": f"Unknown card type '{kind}'."}, status=400)
            kept.append(DashboardTile(
                dashboard=board,
                kind=kind,
                title=str(item.get("title") or "")[:140],
                subtitle=str(item.get("subtitle") or "")[:200],
                x=max(0, min(11, int(item.get("x") or 0))),
                y=max(0, int(item.get("y") or 0)),
                w=max(1, min(12, int(item.get("w") or 3))),
                h=max(1, min(12, int(item.get("h") or 2))),
                spec=item.get("spec") if isinstance(item.get("spec"), dict) else {},
                filters=item.get("filters") if isinstance(item.get("filters"), list) else [],
                filter_match="any" if item.get("filter_match") == "any" else "all",
                alert=item.get("alert") if isinstance(item.get("alert"), dict) else {},
                order=index,
            ))
        board.tiles.all().delete()
        DashboardTile.objects.bulk_create(kept)

    board.refresh_from_db()
    return JsonResponse({"ok": True, "dashboard": board.as_dict()})


@login_required
@require_POST
def dashboard_duplicate(request, code, dashboard_id):
    survey = _survey(request, code, need="edit")
    source = get_object_or_404(LiveDashboard, id=dashboard_id, survey=survey)
    tiles = list(source.tiles.all())
    source.pk = None
    source.public_token = ""
    source.is_public = False
    source.name = f"{source.name} (copy)"[:140]
    source.created_by = request.user
    source.save()
    DashboardTile.objects.bulk_create([
        DashboardTile(
            dashboard=source, kind=t.kind, title=t.title, subtitle=t.subtitle,
            x=t.x, y=t.y, w=t.w, h=t.h, spec=t.spec, filters=t.filters,
            filter_match=t.filter_match, alert=t.alert, order=t.order,
        )
        for t in tiles
    ])
    return JsonResponse({"ok": True, "dashboard": source.as_dict()})


@login_required
@require_POST
def dashboard_delete(request, code, dashboard_id):
    survey = _survey(request, code, need="edit")
    board = get_object_or_404(LiveDashboard, id=dashboard_id, survey=survey)
    board.delete()
    return JsonResponse({"ok": True})


@login_required
@require_POST
def dashboard_rotate_token(request, code, dashboard_id):
    survey = _survey(request, code, need="edit")
    board = get_object_or_404(LiveDashboard, id=dashboard_id, survey=survey)
    board.rotate_token()
    return JsonResponse({"ok": True, "public_token": board.public_token})
