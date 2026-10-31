"""
kura/agent_views.py — HTTP endpoints for Kora, Kura's AI assistant.

    GET  /kura/agent/status/?code=…   enabled?, quota, what this user may do
    POST /kura/agent/chat/            one chat turn → reply text + rendered blocks
    POST /kura/agent/export/          re-run a block's spec → CSV / Excel / HTML / …
    POST /kura/agent/apply/           make it real: new survey, add questions,
                                      live dashboard, studio pipeline, dataset

Permissions ride on kura/teams.access_for — the same gate every other Kura
screen uses — so Kora can never show a supervisor another team's rows, or
let a viewer download what the Data page wouldn't.

The chat view is async on purpose (see hanns/views.deck_ai): a Gemini call
can take many seconds, so it runs on its own worker thread while quick
database steps stay on Django's normal thread.
"""

from __future__ import annotations

import json
import logging

from django.contrib.auth.decorators import login_required
from django.core.exceptions import RequestDataTooBig
from django.db import transaction
from django.http import Http404, HttpResponse, JsonResponse
from django.views.decorators.http import require_GET, require_POST

from . import agent_ai, agent_engine as eng
from .models import Survey

logger = logging.getLogger(__name__)

AGENT_ROLES = {"owner", "editor", "analyst", "viewer", "supervisor"}
MAX_MESSAGE = 4000


class Denied(Exception):
    def __init__(self, message, status=403):
        super().__init__(message)
        self.status = status


# ─────────────────────────── context & permissions ───────────────────────────

def capabilities(user, survey):
    """(access, can-dict) or (None, None) when Kora must not appear."""
    from .teams import access_for
    access = access_for(user, survey)
    if access.role not in AGENT_ROLES and not access.is_supervisor:
        return access, None
    collab_role = getattr(access.collaborator, "role", None)
    can = {
        "view": bool(access.can_view_all_data or access.is_supervisor),
        "build": bool(access.can_build),
        "export": bool(access.can_export),
        "pipelines": bool(access.is_owner),
        "datasets": bool(access.is_owner),
        "dashboards": bool(access.is_owner or collab_role in ("editor", "analyst")),
        "state": bool(access.is_owner),
    }
    return access, can


def build_context(user, code=None, page="list", draft=None) -> eng.AgentContext:
    page = page if page in agent_ai.PAGE_NAMES else "list"
    if not code:
        return eng.AgentContext(user=user, page="list", can={"build": True})
    survey = Survey.objects.filter(code=str(code).upper()[:12]).first()
    if survey is None:
        raise Denied("That survey no longer exists.", status=404)
    access, can = capabilities(user, survey)
    if can is None:
        raise Denied("You don't have access to this survey.", status=404)
    scope = None
    if can["view"] and not access.can_view_all_data:
        from .models_team import TeamMember
        scope = list(TeamMember.objects.filter(team__in=access.supervised_teams, is_active=True)
                     .values_list("user_id", flat=True))
    schema = eng.survey_schema(survey)
    draft_schema = None
    if page == "builder" and can["build"] and isinstance(draft, dict) and isinstance(draft.get("questions"), list):
        draft_schema = draft
    # In the builder the live draft is what the user is looking at.
    catalog_schema = schema if survey.current_version else (draft_schema or schema)
    return eng.AgentContext(user=user, survey=survey, access=access, page=page, schema=catalog_schema,
                            draft_schema=draft_schema, catalog=eng.build_catalog(catalog_schema),
                            can=can, scope_user_ids=scope)


def _json_body(request):
    try:
        data = json.loads(request.body.decode("utf-8") or "{}")
    except (ValueError, UnicodeDecodeError, RequestDataTooBig):
        return None
    return data if isinstance(data, dict) else None


def _error(message, status=400, **extra):
    return JsonResponse({"ok": False, "error": message, **extra}, status=status)


PAGE_CHIPS = {
    "list": ["Draft a household survey", "Show my surveys", "What can you do?"],
    "builder": ["Review my form", "Add a consent section", "Suggest skip logic"],
    "data": ["What's in my data?", "Find data problems", "Make a privacy-safe copy"],
    "studio": ["Clean my data", "Find outliers", "Build a cleaning pipeline"],
    "dashboards": ["Make a dashboard", "Key numbers as cards", "Map the responses"],
    "dashboard": ["Suggest cards for this board", "Chart responses over time", "Make a dashboard"],
    "monitor": ["How is collection going?", "Responses per day", "Where are responses from?"],
    "live_map": ["Map responses by region", "How is collection going?", "Responses per day"],
    "teams": ["How is collection going?", "Responses by collector", "Find data problems"],
    "team_board": ["How is my team doing today?", "Find data problems", "Responses per day"],
}


# ─────────────────────────── endpoints ───────────────────────────

@login_required
@require_GET
def status(request):
    code = request.GET.get("code") or None
    page = request.GET.get("page") or "list"
    try:
        ctx = build_context(request.user, code, page)
    except Denied as e:
        return _error(str(e), e.status)
    surveys = []
    if ctx.survey is None:
        surveys = [{"code": c, "title": t} for c, t in
                   Survey.objects.filter(owner=request.user).values_list("code", "title")[:50]]
    return JsonResponse({
        "ok": True,
        "enabled": agent_ai.agent_enabled(),
        "ai": agent_ai.ai_enabled(),
        "quotaLeft": agent_ai.quota_left(request.user.pk),
        "hourlyLimit": agent_ai.hourly_limit(),
        "can": ctx.can,
        "survey": ({"code": ctx.survey.code, "title": ctx.survey.title, "state": ctx.survey.state}
                   if ctx.survey else None),
        "surveys": surveys,
        "chips": PAGE_CHIPS.get(ctx.page if ctx.survey else "list", PAGE_CHIPS["list"]),
    })


def _turn(user, payload):
    """Context, quota and the prompt (sync, DB thread).
    Returns (ctx, message, prompt_or_None, reason_or_None)."""
    message = str(payload.get("message") or "").strip()[:MAX_MESSAGE]
    if not message:
        raise Denied("Type a message first.", status=400)
    ctx = build_context(user, payload.get("code"), payload.get("page") or "list", payload.get("draft"))
    history = payload.get("history") if isinstance(payload.get("history"), list) else []
    history = [h for h in history[-10:] if isinstance(h, dict)]
    use_ai = False
    if agent_ai.ai_enabled():
        try:
            agent_ai.take_quota(user.pk)
            use_ai = True
        except agent_ai.AgentError:
            use_ai = False
    if ctx.survey is not None and ctx.can.get("view"):
        _ = ctx.frame  # load once here, on the DB thread
    prompt, reason = agent_ai.prepare(ctx, message, history, use_ai)
    return ctx, message, prompt, reason


def _finish(ctx, message, ai_result, reason):
    plan, model, notice = agent_ai.finish(ctx, message, ai_result, reason)
    blocks, made = _execute(ctx, plan)
    return plan, model, notice, blocks, made


def _execute(ctx, plan):
    blocks = []
    made = []
    for action in plan["actions"]:
        block = eng.run_tool(ctx, action)
        blocks.append(block)
        if block.get("type") != "error":
            made.append(f"{action.get('tool')}: {eng._clip_text(block.get('title') or '', 60)}")
    return blocks, made


async def chat(request):
    from asgiref.sync import sync_to_async

    if request.method != "POST":
        return _error("POST only.", 405)
    user = await request.auser()
    if not user.is_authenticated:
        return _error("Please sign in again.", 401)
    if not agent_ai.agent_enabled():
        return _error("Kora is switched off on this server.", 503)
    payload = _json_body(request)
    if payload is None:
        return _error("That request was too large or malformed.")
    try:
        ctx, message, prompt, reason = await sync_to_async(_turn)(user, payload)
    except Denied as e:
        return _error(str(e), e.status)
    try:
        ai_result = None
        if prompt:
            # Network only — safe on a worker thread, and it keeps a slow
            # Gemini answer from holding Django's request thread.
            ai_result, reason = await sync_to_async(agent_ai.run_ai_safely, thread_sensitive=False)(prompt)
        plan, model, notice, blocks, made = await sync_to_async(_finish)(ctx, message, ai_result, reason)
    except Exception:
        logger.exception("Kora chat turn failed")
        return _error("Something went wrong on my side — try again in a moment.", 500)
    if blocks and all(b.get("type") == "error" for b in blocks) and plan["mood"] != "oops":
        plan["mood"] = "oops"
    left = await sync_to_async(agent_ai.quota_left)(user.pk)
    return JsonResponse({
        "ok": True,
        "say": plan["say"],
        "mood": plan["mood"],
        "blocks": blocks,
        "suggestions": plan["suggestions"],
        "made": made,
        "model": model,
        "notice": notice,
        "quotaLeft": left,
    })


@login_required
@require_POST
def export(request):
    from . import agent_export
    payload = _json_body(request)
    if payload is None:
        return _error("Malformed request.")
    spec = payload.get("spec") if isinstance(payload.get("spec"), dict) else {}
    fmt = str(payload.get("format") or "csv")
    try:
        ctx = build_context(request.user, payload.get("code"), payload.get("page") or "list", payload.get("draft"))
        if spec.get("tool") in eng.DATA_TOOLS and not ctx.can.get("view"):
            raise Denied("You can't see this survey's data.")
        data, filename, ctype = agent_export.export(ctx, spec, fmt)
    except Denied as e:
        return _error(str(e), e.status)
    except (agent_export.ExportError, eng.ToolError) as e:
        return _error(str(e), 400)
    except Exception:
        logger.exception("Kora export failed (%s)", fmt)
        return _error("The file could not be built — try again.", 500)
    resp = HttpResponse(data, content_type=ctype)
    resp["Content-Disposition"] = f'attachment; filename="{filename}"'
    resp["X-Kora-Filename"] = filename
    resp["Cache-Control"] = "no-store"
    return resp


@login_required
@require_POST
def apply(request):
    payload = _json_body(request)
    if payload is None:
        return _error("Malformed request.")
    action = payload.get("action")
    try:
        if action == "create_survey":
            return _apply_create_survey(request, payload)
        ctx = build_context(request.user, payload.get("code"), payload.get("page") or "list")
        if ctx.survey is None:
            raise Denied("Open a survey first.", status=400)
        if action == "add_questions":
            return _apply_add_questions(ctx, payload)
        if action == "create_dashboard":
            return _apply_dashboard(request, ctx, payload)
        if action == "save_pipeline":
            return _apply_pipeline(request, ctx, payload)
        if action == "save_dataset":
            return _apply_dataset(request, ctx, payload)
        if action == "set_state":
            return _apply_state(ctx, payload)
    except Denied as e:
        return _error(str(e), e.status)
    except eng.ToolError as e:
        return _error(str(e), 400)
    return _error("Unknown action.")


def _apply_create_survey(request, payload):
    qs = eng.sanitize_questions(payload.get("questions"))
    if not qs:
        raise Denied("There are no questions to save.", status=400)
    survey = Survey.objects.create(
        owner=request.user,
        title=str(payload.get("title") or "Untitled survey").strip()[:140] or "Untitled survey",
        description=str(payload.get("description") or "")[:2000],
        draft_schema={"settings": {"anonymous": True, "shuffle_questions": False, "languages": ["en"]},
                      "questions": qs},
    )
    return JsonResponse({"ok": True, "code": survey.code, "url": f"/kura/{survey.code}/build/",
                         "message": f"Created “{survey.title}” with {len(qs)} questions."})


def _apply_add_questions(ctx, payload):
    if not ctx.can.get("build"):
        raise Denied("You can't edit this questionnaire.")
    survey = ctx.survey
    schema = survey.draft_schema or {}
    schema.setdefault("settings", {"anonymous": True, "languages": ["en"]})
    existing = schema.get("questions") or []
    mode = payload.get("mode")
    if mode == "replace":
        existing = []
    names = []
    for q in existing:
        names.append(q.get("name"))
        names.extend(c.get("name") for c in q.get("children") or [])
    qs = eng.sanitize_questions(payload.get("questions"), [n for n in names if n])
    if not qs:
        raise Denied("There are no questions to add.", status=400)
    schema["questions"] = existing + qs
    survey.draft_schema = schema
    survey.save(update_fields=["draft_schema", "updated_at"])
    return JsonResponse({"ok": True, "url": f"/kura/{survey.code}/build/", "added": len(qs),
                         "message": f"{'Replaced the form with' if mode == 'replace' else 'Added'} {len(qs)} question(s)."})


def _apply_dashboard(request, ctx, payload):
    if not ctx.can.get("dashboards"):
        raise Denied("You can't create dashboards on this survey.")
    from .models_dashboard import THEME_PRESETS, DashboardTile, LiveDashboard
    tiles = eng.layout_tiles(eng.clean_tiles(ctx, payload.get("tiles")))
    if not tiles:
        raise Denied("The dashboard has no cards.", status=400)
    theme = payload.get("theme") if payload.get("theme") in THEME_PRESETS else "studio"
    with transaction.atomic():
        board = LiveDashboard.objects.create(
            survey=ctx.survey, created_by=request.user, source="submissions", theme=theme,
            name=str(payload.get("title") or "Kora dashboard")[:140],
            description="Built with Kora, Kura's AI assistant.")
        DashboardTile.objects.bulk_create([
            DashboardTile(dashboard=board, kind=t["kind"], title=t["title"][:140], subtitle=t.get("subtitle", "")[:200],
                          x=t["x"], y=t["y"], w=t["w"], h=t["h"], spec=t["spec"], filters=t.get("filters") or [],
                          filter_match="all", order=i)
            for i, t in enumerate(tiles)])
    return JsonResponse({"ok": True, "url": f"/kura/{ctx.survey.code}/dash/{board.id}/",
                         "message": f"Live dashboard “{board.name}” created with {len(tiles)} cards."})


def _apply_pipeline(request, ctx, payload):
    if not ctx.can.get("pipelines"):
        raise Denied("Only the survey owner can save Data Studio pipelines.")
    from .models import CleaningPipeline, PipelineStep
    steps = eng.clean_steps(ctx, {"steps": payload.get("steps")})
    with transaction.atomic():
        pipe = CleaningPipeline.objects.create(
            survey=ctx.survey, created_by=request.user, is_active=False,
            name=str(payload.get("name") or "Kora cleaning pipeline")[:140],
            description="Proposed by Kora. Review the steps, then run it in the Data Studio.")
        PipelineStep.objects.bulk_create([
            PipelineStep(pipeline=pipe, order=i, operation=s["operation"], name=s["name"][:140],
                         config=s["config"], enabled=True, stop_on_error=False, note="Added by Kora")
            for i, s in enumerate(steps)])
    return JsonResponse({"ok": True, "url": f"/kura/{ctx.survey.code}/studio/?pipeline={pipe.id}",
                         "message": f"Saved “{pipe.name}” with {len(steps)} step(s) to the Data Studio."})


def _apply_dataset(request, ctx, payload):
    if not ctx.can.get("datasets"):
        raise Denied("Only the survey owner can save datasets.")
    from .models import UploadedDataset
    spec = payload.get("spec") if isinstance(payload.get("spec"), dict) else {}
    df, plan, kinfo = eng.run_privacy(ctx, spec)
    cols, rows = eng.frame_records(df)
    ds = UploadedDataset.objects.create(
        survey=ctx.survey, uploaded_by=request.user,
        name=str(payload.get("name") or f"{ctx.survey.title} — privacy-safe")[:140],
        original_filename="kora-privacy-safe.csv", columns=cols, rows=rows, row_count=len(rows))
    return JsonResponse({"ok": True, "url": f"/kura/{ctx.survey.code}/studio/",
                         "message": f"Saved “{ds.name}” ({len(rows)} rows, {len(cols)} columns) to the Data Studio’s files."})


def _apply_state(ctx, payload):
    if not (ctx.access and ctx.access.is_owner):
        raise Denied("Only the survey owner can pause or close collection.")
    state = payload.get("state")
    if state not in ("collecting", "paused", "closed"):
        raise Denied("Pick collecting, paused or closed.", status=400)
    if state == "collecting" and not ctx.survey.current_version:
        raise Denied("Publish the survey first.", status=400)
    ctx.survey.state = state
    ctx.survey.save(update_fields=["state", "updated_at"])
    return JsonResponse({"ok": True, "message": f"The survey is now {state}."})
