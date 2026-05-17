from django.contrib.auth.decorators import login_required
from django.shortcuts import render, redirect
from polls.models import Questionnaire
from games.models import Quiz
from presentations.models import LiveSession
from attendance.models import AttendanceEvent
from attendance.venue_models import Venue

from subscriptions.services import (
    count_items_for_user,
    get_effective_plan,
    get_effective_subscription,
    user_can_create_item,
)


# How many items per app section we show on the dashboard.
# Anything past this is reachable via the "See all" link beneath each list.
DASHBOARD_RECENT_LIMIT = 5

# Cap on advertised venues rendered on the public homepage. Keeps the page
# from bloating if the super-admin flags too many; sort order is controlled
# per-venue via Venue.advertise_order.
HOME_VENUE_ADS_LIMIT = 8


def home(request):
    # Logged-in users skip straight to their dashboard — they have the
    # venue picker on the event-create form, so the marketing homepage
    # would just be noise for them.
    if request.user.is_authenticated:
        return redirect("core:dashboard")

    # Anonymous visitor: render the marketing homepage and pass through
    # the curated venue advertisements. Venue.advertised() already
    # filters to active + global + advertise=True and orders by the
    # super-admin's chosen `advertise_order`, so we just slice it.
    advertised_venues = list(Venue.advertised()[:HOME_VENUE_ADS_LIMIT])

    return render(request, "core/home.html", {
        "advertised_venues": advertised_venues,
    })


@login_required
def dashboard(request):
    # Self-heal: ensure a Profile exists for legacy users created before the signal was wired
    from accounts.models import Profile
    Profile.objects.get_or_create(
        user=request.user,
        defaults={"display_name": request.user.username},
    )

    # We show the 5 most-recent items per app on the dashboard. The full lists
    # live in each app's own "list" view (polls:list, games:list,
    # attendance:event_list) which we link to via "See all".
    questionnaires = (
        Questionnaire.objects.filter(owner=request.user)
        .order_by("-updated_at")[:DASHBOARD_RECENT_LIMIT]
    )
    quizzes = (
        Quiz.objects.filter(owner=request.user)
        .order_by("-updated_at")[:DASHBOARD_RECENT_LIMIT]
    )
    recent_sessions = LiveSession.objects.filter(owner=request.user).order_by("-created_at")[:5]
    attendance_events = (
        AttendanceEvent.objects.filter(owner=request.user)
        .order_by("-starts_at")[:DASHBOARD_RECENT_LIMIT]
    )

    # Totals so the section headers / footers can read "See all (12)".
    questionnaires_total = Questionnaire.objects.filter(owner=request.user).count()
    quizzes_total = Quiz.objects.filter(owner=request.user).count()
    attendance_events_total = AttendanceEvent.objects.filter(owner=request.user).count()

    plan = get_effective_plan(request.user)
    subscription = get_effective_subscription(request.user)
    membership = request.user.active_membership()
    items_used = count_items_for_user(request.user)

    quota = None
    if plan and not plan.is_unlimited:
        quota = {
            "used": items_used,
            "limit": plan.item_limit,
            "remaining": max(plan.item_limit - items_used, 0),
            "percent": min(int(items_used / plan.item_limit * 100), 100) if plan.item_limit else 0,
        }

    return render(request, "core/dashboard.html", {
        "questionnaires": questionnaires,
        "quizzes": quizzes,
        "recent_sessions": recent_sessions,
        "attendance_events": attendance_events,

        # Totals + cap, so the template can show "See all (N)" only when it
        # makes sense (i.e. when there are more items than fit on the dashboard).
        "questionnaires_total": questionnaires_total,
        "quizzes_total": quizzes_total,
        "attendance_events_total": attendance_events_total,
        "recent_limit": DASHBOARD_RECENT_LIMIT,

        "plan": plan,
        "subscription": subscription,
        "membership": membership,
        "organization": membership.organization if membership else None,
        "quota": quota,
        "can_create": user_can_create_item(request.user),
    })


def join(request):
    return render(request, "core/join.html")