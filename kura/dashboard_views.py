"""
kura/dashboard_views.py — endpoints for the live dashboard builder.

Access model
------------
Editing is owner-or-editor. Viewing is owner, any collaborator, or — only
when the owner has explicitly switched it on — anyone holding the share
link. The share link is deliberately a separate, rotatable token rather
than the survey code: the survey code is printed on QR posters and handed
to enumerators, and it must never become a key to the results screen.

Publishing
----------
The share link serves a *published version* (``published_config``), not
the working copy, so the builder can autosave freely without viewers
watching half-built cards. "Publish" freezes the current layout + theme,
"Update published version" re-freezes it, "Unpublish" switches the link
off (the frozen copy is kept), and "New link" rotates the token so every
old copy of the URL — and every QR code printed from it — stops working.
A link can carry an expiry and an embed permission.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta

from django.contrib.auth.decorators import login_required
from django.db import transaction
from django.db.models import F
from django.http import Http404, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.http import require_GET, require_POST

from .dashboard_engine import dashboard_payload, field_catalogue
from .models import CleaningRun, Survey
from .models_dashboard import (
    THEME_PRESETS,
    DashboardTile,
    LiveDashboard,
    clean_theme_config,
)

VALID_KINDS = {k for k, _ in DashboardTile.KIND_CHOICES}
MAX_TILES = 40
MAX_ROWS_TALL = 16
EXPIRY_DELTAS = {
    "1h": timedelta(hours=1),
    "24h": timedelta(hours=24),
    "7d": timedelta(days=7),
    "30d": timedelta(days=30),
}


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


def _can_edit(request, survey):
    if survey.owner_id == request.user.id:
        return True
    collab = survey.collaborators.filter(user=request.user).first()
    return bool(collab and collab.role in ("editor", "analyst"))


def _json(request):
    try:
        return json.loads(request.body.decode("utf-8") or "{}")
    except (ValueError, UnicodeDecodeError):
        return None


def _int(value, default):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


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
    can_edit = _can_edit(request, survey)
    return render(request, "kura/live_dashboard.html", {
        "survey": survey,
        "board": board,
        "can_edit": can_edit,
        "public": False,
        "boot": {
            "dashboard": board.as_dict(),
            "themes": THEME_PRESETS,
            "survey": {"code": survey.code, "title": survey.title},
            "dashboards": [
                {"id": d.id, "name": d.name, "public": d.share_active}
                for d in survey.live_dashboards.all()
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
        },
    })


def _public_board(token):
    return LiveDashboard.objects.filter(
        public_token=token, is_public=True,
    ).select_related("survey", "published_by").first()


def public_dashboard(request, token):
    """Read-only board behind a rotatable share token — the projector view.

    Renders the *published* layout and theme. ``?embed=1`` strips the chrome
    for iframes (only honoured when the owner allowed embedding) and
    ``?tv=1`` starts in full-bleed kiosk layout.
    """
    board = _public_board(token)
    if board is None:
        return _unavailable(request, "missing")
    if board.share_expired:
        return _unavailable(request, "expired", board)

    LiveDashboard.objects.filter(pk=board.pk).update(public_views=F("public_views") + 1)

    config = board.public_config()
    embed = request.GET.get("embed") == "1" and board.allow_embed
    public_dict = {
        "id": board.id,
        "name": config.get("name") or board.name,
        "description": config.get("description", ""),
        "theme": config.get("theme") or board.theme,
        "theme_config": clean_theme_config(config.get("theme_config")),
        "tiles": config.get("tiles") or [],
        "filters": [], "filter_match": "all",
        "source_label": board.source_label,
        "is_streaming": board.is_streaming,
        "refresh_seconds": board.refresh_seconds,
        "public_token": board.public_token,
        "published_at": board.published_at.isoformat() if board.published_at else None,
        "share_expires_at": (board.share_expires_at.isoformat()
                             if board.share_expires_at else None),
        "publish_options": config.get("options") or {},
    }
    response = render(request, "kura/live_dashboard.html", {
        "survey": board.survey,
        "board": board,
        "board_name": public_dict["name"],
        "can_edit": False,
        "public": True,
        "embed": embed,
        "boot": {
            "dashboard": public_dict,
            "themes": THEME_PRESETS,
            "survey": {"code": "", "title": board.survey.title},
            "dashboards": [], "pipelines": [], "datasets": [], "runs": [],
            "embed": embed,
            "tv": request.GET.get("tv") == "1",
        },
    })
    if board.allow_embed:
        response.xframe_options_exempt = True
    # Share links must never be cached by a proxy under another viewer's
    # session, and must not leak the token onwards via Referer.
    response["Cache-Control"] = "no-store"
    response["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


def _unavailable(request, reason, board=None):
    return render(request, "kura/dashboard_unavailable.html", {
        "reason": reason,
        "board": board,
    }, status=410 if reason == "expired" else 404)


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
    board = _public_board(token)
    if board is None or board.share_expired:
        return JsonResponse({"ok": False, "error": "This link is no longer active.",
                             "expired": True}, status=410)
    response = JsonResponse(_data_response(request, board, config=board.public_config()))
    if board.allow_embed:
        response.xframe_options_exempt = True
    response["Cache-Control"] = "no-store"
    return response


def _data_response(request, board, config=None):
    tile_ids = None
    raw = request.GET.get("tiles")
    if raw:
        tile_ids = [int(v) for v in raw.split(",") if v.strip().lstrip("-").isdigit()]

    # ?since=<stamp> lets a polling client skip the whole computation when
    # nothing has arrived. Twenty idle browsers then cost two DB aggregates
    # each, not twenty full passes over the data.
    payload = dashboard_payload(
        board,
        schema=_schema(board.survey),
        tile_ids=tile_ids,
        use_cache=request.GET.get("fresh") != "1",
        config=config,
    )
    since = request.GET.get("since")
    if since and since == payload["stamp"] and not tile_ids:
        return {"ok": True, "unchanged": True, "stamp": payload["stamp"],
                "pulse": payload["pulse"], "meta": payload["meta"],
                "generated_at": payload["generated_at"]}
    if config is not None:
        # A public viewer needs the numbers, not the internals: column
        # lists and pipeline errors describe the survey, not the board.
        payload["meta"] = {"filtered_rows": payload["meta"].get("filtered_rows"),
                           "rows": payload["meta"].get("rows")}
    return payload


def _clean_tiles(raw_tiles, keep_ids=False):
    """Validate a client tile list. Returns (list_of_dicts, error)."""
    if not isinstance(raw_tiles, list):
        return [], None
    if len(raw_tiles) > MAX_TILES:
        return None, f"A board holds at most {MAX_TILES} cards."
    out = []
    for index, item in enumerate(raw_tiles):
        if not isinstance(item, dict):
            continue
        kind = item.get("kind")
        if kind not in VALID_KINDS:
            return None, f"Unknown card type '{kind}'."
        x = max(0, min(11, _int(item.get("x"), 0)))
        tile = {
            "kind": kind,
            "title": str(item.get("title") or "")[:140],
            "subtitle": str(item.get("subtitle") or "")[:200],
            "x": x,
            "y": max(0, min(500, _int(item.get("y"), 0))),
            "w": max(1, min(12 - x, _int(item.get("w"), 3))),
            "h": max(1, min(MAX_ROWS_TALL, _int(item.get("h"), 2))),
            "spec": item.get("spec") if isinstance(item.get("spec"), dict) else {},
            "filters": item.get("filters") if isinstance(item.get("filters"), list) else [],
            "filter_match": "any" if item.get("filter_match") == "any" else "all",
            "alert": item.get("alert") if isinstance(item.get("alert"), dict) else {},
            "order": index,
        }
        if keep_ids:
            tile["id"] = _int(item.get("id"), -(index + 1))
        out.append(tile)
    return out, None


@login_required
@require_POST
def dashboard_preview(request, code, dashboard_id):
    """Compute the editor's IN-MEMORY layout without saving it.

    The builder calls this on every change, so a card you just dropped (or
    a filter you just typed) shows real numbers immediately — before, a new
    card sat on "loading…" until Save, because /data/ only knows the saved
    tiles. Tile ids are echoed back untouched, including the negative ids
    of unsaved cards.
    """
    survey = _survey(request, code, need="edit")
    board = get_object_or_404(LiveDashboard, id=dashboard_id, survey=survey)
    data = _json(request)
    if data is None:
        return JsonResponse({"ok": False, "error": "JSON body required."}, status=400)

    tiles, error = _clean_tiles(data.get("tiles"), keep_ids=True)
    if error:
        return JsonResponse({"ok": False, "error": error}, status=400)
    filters = data.get("filters") if isinstance(data.get("filters"), list) else []
    config = {
        "tiles": tiles,
        "filters": filters[:20],
        "filter_match": "any" if data.get("filter_match") == "any" else "all",
    }
    only = data.get("tile_ids")
    tile_ids = [_int(v, 0) for v in only] if isinstance(only, list) and only else None

    payload = dashboard_payload(
        board, schema=_schema(survey), tile_ids=tile_ids,
        use_cache=not data.get("fresh"), config=config,
    )
    since = data.get("since")
    if since and since == payload["stamp"] and not tile_ids:
        return JsonResponse({"ok": True, "unchanged": True, "stamp": payload["stamp"],
                             "pulse": payload["pulse"], "meta": payload["meta"],
                             "generated_at": payload["generated_at"]})
    return JsonResponse(payload)


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

    # Validate the tiles BEFORE touching the board, so a bad card can never
    # leave the settings saved and the layout not.
    new_tiles = None
    if isinstance(data.get("tiles"), list):
        new_tiles, error = _clean_tiles(data["tiles"])
        if error:
            return JsonResponse({"ok": False, "error": error}, status=400)

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
        board.theme = data["theme"] if data["theme"] in THEME_PRESETS else "studio"
    if "theme_config" in data:
        board.theme_config = clean_theme_config(data["theme_config"])
    if "refresh_seconds" in data:
        try:
            board.refresh_seconds = max(0, min(3600, int(data["refresh_seconds"])))
        except (TypeError, ValueError):
            pass
    if "is_live" in data:
        board.is_live = bool(data["is_live"])
    # is_public is deliberately NOT settable here any more: the builder
    # autosaves, and a stray autosave must never switch a link on or off.
    # Use the publish / unpublish endpoints.
    if "include_excluded" in data:
        board.include_excluded = bool(data["include_excluded"])
    with transaction.atomic():
        board.save()
        if new_tiles is not None:
            board.tiles.all().delete()
            DashboardTile.objects.bulk_create(
                [DashboardTile(dashboard=board, **t) for t in new_tiles])

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
    source.published_config = None
    source.published_at = None
    source.published_by = None
    source.share_expires_at = None
    source.public_views = 0
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
    """New link. Every copy of the old URL (and every QR printed from it) dies."""
    survey = _survey(request, code, need="edit")
    board = get_object_or_404(LiveDashboard, id=dashboard_id, survey=survey)
    board.rotate_token()
    board.refresh_from_db()
    return JsonResponse({"ok": True, "public_token": board.public_token,
                         "dashboard": board.as_dict()})


def _parse_expiry(data):
    """Return (datetime|None, error|None) from the publish dialog's choice."""
    choice = data.get("expires") or "never"
    if choice == "never":
        return None, None
    if choice in EXPIRY_DELTAS:
        return timezone.now() + EXPIRY_DELTAS[choice], None
    if choice == "custom":
        raw = str(data.get("expires_at") or "").strip()
        try:
            when = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return None, "Pick a valid expiry date."
        if timezone.is_naive(when):
            when = timezone.make_aware(when, timezone.get_current_timezone())
        if when <= timezone.now():
            return None, "The expiry must be in the future."
        return when, None
    return None, "Unknown expiry option."


PUBLISH_OPTION_KEYS = ("show_header", "show_pulse", "show_clock", "show_footer")


@login_required
@require_POST
def dashboard_publish(request, code, dashboard_id):
    """Freeze the working copy onto the share link (or refresh the frozen copy)."""
    survey = _survey(request, code, need="edit")
    board = get_object_or_404(LiveDashboard, id=dashboard_id, survey=survey)
    data = _json(request) or {}

    if not board.tiles.exists():
        return JsonResponse({"ok": False,
                             "error": "Add at least one card before publishing."},
                            status=400)

    expires, error = _parse_expiry(data)
    if error:
        return JsonResponse({"ok": False, "error": error}, status=400)

    raw_options = data.get("options") if isinstance(data.get("options"), dict) else {}
    options = {key: bool(raw_options.get(key, True)) for key in PUBLISH_OPTION_KEYS}

    if data.get("rotate"):
        board.public_token = ""          # save() in publish() mints a new one
    board.share_expires_at = expires
    board.allow_embed = bool(data.get("allow_embed"))
    board.publish(user=request.user, options=options)
    board.refresh_from_db()
    return JsonResponse({
        "ok": True,
        "dashboard": board.as_dict(),
        "url": request.build_absolute_uri(
            reverse("kura:public_dashboard", args=[board.public_token])),
    })


@login_required
@require_POST
def dashboard_unpublish(request, code, dashboard_id):
    survey = _survey(request, code, need="edit")
    board = get_object_or_404(LiveDashboard, id=dashboard_id, survey=survey)
    board.unpublish()
    board.refresh_from_db()
    return JsonResponse({"ok": True, "dashboard": board.as_dict()})


@login_required
@require_GET
def dashboard_qr(request, code, dashboard_id):
    """SVG QR of the share link, for posters and the projector corner."""
    import qrcode
    import qrcode.image.svg

    survey = _survey(request, code)
    board = get_object_or_404(LiveDashboard, id=dashboard_id, survey=survey)
    url = request.build_absolute_uri(
        reverse("kura:public_dashboard", args=[board.public_token]))
    image = qrcode.make(url, image_factory=qrcode.image.svg.SvgPathImage,
                        box_size=10, border=2)
    response = HttpResponse(image.to_string(), content_type="image/svg+xml")
    if request.GET.get("download") == "1":
        response["Content-Disposition"] = (
            f'attachment; filename="kura-dashboard-{board.id}-qr.svg"')
    return response
