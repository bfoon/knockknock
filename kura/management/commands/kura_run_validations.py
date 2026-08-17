"""
Optional backstop: run a survey's validation suite if nobody ran it.

The normal flow is that the SUPERVISOR presses "run the checks" on their
board once the day's collection is finished — they know when the team has
actually stopped, a clock does not. This command exists for the day that
does not happen, and is inert unless the owner switches
TeamConfig.validation_enabled on (it defaults to off).

It is also the way to run the checks unattended from a script:
`--code ABC123 --force` ignores both the switch and the clock.

Designed to be woken up often and do nothing most of the time, so point
either cron or Celery beat at it every 15 minutes:

    */15 * * * *  cd /app && python manage.py kura_run_validations

    # celery beat
    "kura-validations": {
        "task": "django.core.management.call_command",
        "schedule": crontab(minute="*/15"),
        "args": ("kura_run_validations",),
    }

A survey is due when all of these hold:
    · TeamConfig.team_collection and validation_enabled are on
      (validation_enabled is OFF by default — this is opt-in)
    · the survey is collecting or paused
    · local time is at or past TeamConfig.validation_time
    · it has not already run today
    · at least one ValidationCheck exists

Each run is recorded as a ValidationRun, refreshes the issue list, and
drops a system line into every affected team's chat — which is what
tells a supervisor there is something to look at before they sign off.
Runs are serialised per survey, so this waking up mid-way through a
supervisor's own run is safe: it queues behind them.
"""

from django.core.management.base import BaseCommand
from django.utils import timezone

from kura.models_team import TeamConfig
from kura.teams import period_bounds, run_validation, surveys_due_for_validation, \
    to_datetime_range


class Command(BaseCommand):
    help = "Run scheduled end-of-day data validation for Kura surveys."

    def add_arguments(self, parser):
        parser.add_argument(
            "--code", dest="code", default="",
            help="Run one survey by code, ignoring the schedule.",
        )
        parser.add_argument(
            "--force", action="store_true",
            help="Ignore the time-of-day and already-ran-today checks.",
        )
        parser.add_argument(
            "--per-team", action="store_true",
            help="Record one run per team instead of one for the survey.",
        )
        parser.add_argument(
            "--dry-run", action="store_true",
            help="List what would run and exit.",
        )

    def handle(self, *args, **options):
        from kura.models import Survey

        now = timezone.now()

        if options["code"]:
            surveys = list(Survey.objects.filter(code=options["code"].upper()))
            if not surveys:
                self.stderr.write(self.style.ERROR("No survey with that code."))
                return
        elif options["force"]:
            surveys = [
                cfg.survey for cfg in TeamConfig.objects
                .filter(team_collection=True).select_related("survey")
                if cfg.survey.validation_checks.exists()
            ]
        else:
            surveys = surveys_due_for_validation(now)

        if not surveys:
            self.stdout.write("Nothing due.")
            return

        for survey in surveys:
            cfg = TeamConfig.for_survey(survey)
            start_date, end_date = period_bounds(cfg, timezone.localdate(now))
            window = to_datetime_range(start_date, end_date)

            targets = [None]
            if options["per_team"]:
                teams = list(survey.teams.filter(is_active=True))
                targets = teams or [None]

            for team in targets:
                label = f"{survey.code}" + (f"/{team.name}" if team else "")
                if options["dry_run"]:
                    self.stdout.write(f"would run {label} for {start_date}")
                    continue

                run = run_validation(
                    survey, team=team, run_by=None,
                    trigger="schedule", window=window,
                )
                if run.status == "failed":
                    self.stderr.write(self.style.ERROR(
                        f"{label}: failed — {run.error[:200]}"))
                elif run.passed:
                    self.stdout.write(self.style.SUCCESS(
                        f"{label}: clean "
                        f"({run.submissions_checked} responses)"))
                else:
                    self.stdout.write(self.style.WARNING(
                        f"{label}: {run.issues_open} open issue(s) of "
                        f"{run.submissions_checked} responses"))
