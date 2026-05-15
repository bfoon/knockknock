from django.contrib.auth.decorators import login_required
from django.shortcuts import render, redirect
from polls.models import Questionnaire
from games.models import Quiz
from presentations.models import LiveSession
from attendance.models import AttendanceEvent

from subscriptions.services import (
    count_items_for_user,
    get_effective_plan,
    get_effective_subscription,
    user_can_create_item,
)


def home(request):
    if request.user.is_authenticated:
        return redirect("core:dashboard")
    return render(request, "core/home.html")


@login_required
def dashboard(request):
    # Self-heal: ensure a Profile exists for legacy users created before the signal was wired
    from accounts.models import Profile
    Profile.objects.get_or_create(
        user=request.user,
        defaults={"display_name": request.user.username},
    )

    questionnaires = Questionnaire.objects.filter(owner=request.user).order_by("-updated_at")[:10]
    quizzes = Quiz.objects.filter(owner=request.user).order_by("-updated_at")[:10]
    recent_sessions = LiveSession.objects.filter(owner=request.user).order_by("-created_at")[:5]
    attendance_events = AttendanceEvent.objects.filter(owner=request.user).order_by("-starts_at")[:10]

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
        "plan": plan,
        "subscription": subscription,
        "membership": membership,
        "organization": membership.organization if membership else None,
        "quota": quota,
        "can_create": user_can_create_item(request.user),
    })


def join(request):
    return render(request, "core/join.html")