"""
kura/autoclean.py — run the cleaning automatically when new data arrives.

Whenever a submission lands (web runner submit or a mobile sync batch),
the receiving view calls ``schedule(survey)``. After the request's
transaction commits, a short-lived background thread:

  1. runs the survey's enabled Quick flag rules  (cleaning.run_rules)
  2. runs every ACTIVE Data Studio pipeline whose source is the survey's
     submissions, as a new CleaningRun labelled AUTO_LABEL
  3. carries the pipeline's saved "My board" dashboard onto the new run,
     so the board keeps showing — now with the fresh data
  4. prunes old auto runs (manual runs are never touched)
  5. nudges open dashboards / Data pages over the dashboard WS group

Design notes
------------
* Never blocks or breaks collection. The submit view returns as soon as
  the row is saved; every failure in here is logged and swallowed.
* Bursts are coalesced. A sync batch schedules ONE run, not one per row,
  and while a survey's run is in flight any new schedule() just marks it
  "pending" — the worker re-runs once more when it finishes, so the last
  submission is always included without piling up threads.
* Serialised with supervisor validation. run_rules() deletes and
  recreates flags, so it takes the same per-survey row lock
  (TeamConfig select_for_update) that teams.run_validation() holds.
  Auto-runs refresh the survey-wide flags only; team DataIssue lists and
  sign-off stay supervisor-driven — supervisors still press "run the
  checks" as before.
* No Celery needed. The in-process coalescing assumes one web process
  (the Docker setup runs a single daphne); with several processes the DB
  lock still keeps runs correct, you would just get a few extra runs.
* A pipeline is excluded from auto-runs by unticking "Active" on it in
  Data Studio. Uploaded-file pipelines never auto-run (new submissions
  don't change their input).

Settings (all optional):
    KURA_AUTOCLEAN             True   master switch
    KURA_AUTOCLEAN_DELAY       2.0    seconds to wait so bursts coalesce
    KURA_AUTOCLEAN_KEEP_RUNS   5      auto runs kept per pipeline
    KURA_AUTOCLEAN_SYNC        False  run inline after commit (tests)
"""

from __future__ import annotations

import logging
import threading
import time

from django.conf import settings
from django.db import close_old_connections, connection, transaction
from django.utils import timezone

logger = logging.getLogger(__name__)

AUTO_LABEL = "Auto · new data"

_state_lock = threading.Lock()
_active: dict[int, dict] = {}   # survey_id -> {"pending": bool}


def _setting(name, default):
    return getattr(settings, name, default)


def enabled() -> bool:
    return bool(_setting("KURA_AUTOCLEAN", True))


# ── public entry point ───────────────────────────────────────────────

def schedule(survey, reason: str = "submission") -> None:
    """Queue an auto-clean for `survey` once the current transaction commits.

    Safe to call from anywhere, inside or outside an atomic block, as many
    times as you like — calls for the same survey coalesce.
    """
    if not enabled() or survey is None or not getattr(survey, "pk", None):
        return
    survey_id = survey.pk

    def kick():
        if _setting("KURA_AUTOCLEAN_SYNC", False):
            try:
                run_now(survey_id, reason=reason)
            except Exception:
                logger.exception("kura autoclean failed for survey %s", survey_id)
            return

        with _state_lock:
            state = _active.get(survey_id)
            if state is not None:
                state["pending"] = True        # the running worker loops once more
                return
            _active[survey_id] = {"pending": False}

        try:
            threading.Thread(
                target=_worker, args=(survey_id, reason),
                name=f"kura-autoclean-{survey_id}", daemon=True,
            ).start()
        except Exception:
            with _state_lock:
                _active.pop(survey_id, None)
            logger.exception("kura autoclean could not start a worker")

    try:
        transaction.on_commit(kick)
    except Exception:
        logger.exception("kura autoclean could not register on_commit")


def _worker(survey_id: int, reason: str) -> None:
    try:
        while True:
            time.sleep(float(_setting("KURA_AUTOCLEAN_DELAY", 2.0)))
            with _state_lock:
                _active[survey_id]["pending"] = False
            close_old_connections()
            try:
                run_now(survey_id, reason=reason)
            except Exception:
                logger.exception("kura autoclean failed for survey %s", survey_id)
            with _state_lock:
                if not _active.get(survey_id, {}).get("pending"):
                    break
    finally:
        with _state_lock:
            _active.pop(survey_id, None)
        try:
            connection.close()
        except Exception:
            pass


# ── the actual work ──────────────────────────────────────────────────

def _lock_survey(survey) -> None:
    """Take the same per-survey mutex teams.run_validation() uses."""
    try:
        from .models_team import TeamConfig
    except Exception:
        return
    TeamConfig.for_survey(survey)                          # row must exist to lock
    TeamConfig.objects.select_for_update().filter(survey=survey).first()


def run_now(survey_id: int, reason: str = "submission") -> dict:
    """Run quick rules + active submission pipelines for one survey, now.

    Returns a summary dict (also what gets pushed to open pages).
    """
    from .models import Survey

    survey = Survey.objects.filter(pk=survey_id).first()
    if survey is None:
        return {}

    result = {"rules": None, "rules_error": None, "pipelines": []}

    # 1 — Quick flag rules
    if survey.cleaning_rules.filter(enabled=True).exists():
        from .cleaning import run_rules
        try:
            with transaction.atomic():
                _lock_survey(survey)
                result["rules"] = run_rules(survey)
        except Exception as exc:
            logger.exception("kura autoclean: quick rules failed (%s)", survey.code)
            result["rules_error"] = str(exc)[:240]

    # 2 — Data Studio pipelines
    pipelines = survey.pipelines.filter(is_active=True, source="submissions")
    for pipeline in pipelines:
        if not pipeline.steps.filter(enabled=True).exists():
            continue
        result["pipelines"].append(_run_pipeline(pipeline))

    if result["rules"] is not None or result["pipelines"] or result["rules_error"]:
        _notify(survey, result, reason)
    return result


def _run_pipeline(pipeline) -> dict:
    from .models import CleaningRun
    from .pipeline_engine import PipelineExecutor

    run = CleaningRun.objects.create(pipeline=pipeline, label=AUTO_LABEL, run_by=None)
    ok, error = True, ""
    try:
        PipelineExecutor(run).execute()
    except Exception as exc:
        ok, error = False, str(exc)
        # execute() marks the run failed itself, except when loading the
        # source data blows up before its try block — cover that case.
        run.refresh_from_db()
        if run.status != "failed":
            run.status = "failed"
            run.error = error
            run.completed_at = timezone.now()
            run.save(update_fields=["status", "error", "completed_at"])

    if ok:
        try:
            _carry_board(pipeline, run)
        except Exception:
            logger.exception("kura autoclean: board carry-over failed (run %s)", run.id)
    try:
        _prune(pipeline)
    except Exception:
        logger.exception("kura autoclean: prune failed (pipeline %s)", pipeline.id)

    return {
        "pipeline_id": pipeline.id,
        "pipeline": pipeline.name,
        "run_id": run.id,
        "ok": ok,
        "error": error[:240],
        "result_count": run.result_count,
    }


def _carry_board(pipeline, run) -> None:
    """Copy the pipeline's most recently edited "My board" onto the new run.

    Boards hang off a CleaningRun, so without this every automatic run
    would open with an empty board.
    """
    from .models import AnalysisDashboard

    latest = (
        AnalysisDashboard.objects
        .filter(run__pipeline=pipeline, name="Main board")
        .exclude(run=run)
        .order_by("-updated_at")
        .first()
    )
    if latest is None:
        return
    AnalysisDashboard.objects.get_or_create(
        run=run, name="Main board",
        defaults={"definition": latest.definition or {},
                  "created_by_id": latest.created_by_id},
    )


def _prune(pipeline) -> None:
    """Keep the newest N finished auto runs per pipeline; delete the rest.

    Manual runs (any other label) are never deleted, nor is a run that a
    live dashboard is pinned to as its snapshot source.
    """
    from .models import CleaningRun

    keep = max(1, int(_setting("KURA_AUTOCLEAN_KEEP_RUNS", 5)))
    finished = list(
        CleaningRun.objects
        .filter(pipeline=pipeline, label=AUTO_LABEL, status__in=["complete", "failed"])
        .order_by("-started_at", "-id")
        .values_list("id", flat=True)
    )
    stale = finished[keep:]
    if not stale:
        return
    qs = CleaningRun.objects.filter(id__in=stale)
    live = _live_dashboard_model()
    if live is not None:
        if live._meta.db_table not in connection.introspection.table_names():
            # The model is loaded but its table was never migrated, so any
            # CleaningRun delete would crash in Django's SET_NULL collector.
            # Keep the runs rather than fail; run makemigrations/migrate.
            logger.warning("kura autoclean: %s table missing — skipping prune",
                           live._meta.db_table)
            return
        qs = qs.filter(live_dashboards__isnull=True)
    qs.delete()


def _live_dashboard_model():
    from django.apps import apps
    try:
        return apps.get_model("kura", "LiveDashboard")
    except LookupError:
        return None


def _notify(survey, result, reason) -> None:
    """Tell open dashboards / Data pages the cleaned data moved on."""
    rules = result.get("rules") or []
    payload = {
        "type": "data_changed",
        "reason": "autoclean",
        "autoclean": {
            "trigger": reason,
            "rules_run": len(rules),
            "flags": sum(r.get("hits", 0) for r in rules),
            "excluded": sum(r.get("excluded", 0) for r in rules),
            "recoded": sum(r.get("changed", 0) for r in rules),
            "rules_error": result.get("rules_error"),
            "pipelines": result.get("pipelines", []),
            "at": timezone.now().isoformat(),
        },
    }
    try:
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        from .live import dashboard_group

        layer = get_channel_layer()
        if layer is None:
            return
        async_to_sync(layer.group_send)(
            dashboard_group(survey.code), {"type": "fanout", "payload": payload},
        )
    except Exception:
        pass
