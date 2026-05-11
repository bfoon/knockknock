"""
Helpers for resolving a user's effective plan and enforcing quotas.

A user's effective plan is:
  - their organization's plan if they belong to an org (team/corporate)
  - else their personal subscription's plan
  - else the Free plan
"""

from django.shortcuts import redirect
from functools import wraps

from .models import Plan, Subscription


def get_effective_subscription(user):
    """Return the Subscription that governs this user (org-level wins)."""
    if not user.is_authenticated:
        return None
    membership = getattr(user, "active_membership", None)
    if callable(membership):
        membership = membership()
    if membership:
        org_sub = getattr(membership.organization, "subscription", None)
        if org_sub:
            return org_sub
    return getattr(user, "kk_subscription", None)


def get_effective_plan(user):
    sub = get_effective_subscription(user)
    if sub:
        return sub.plan
    return Plan.objects.filter(tier=Plan.TIER_FREE).first()


def count_items_for_user(user):
    """Count of mentis (Questionnaire) + games (Quiz) the user owns.

    For workspace plans the cap is unlimited so this is informational only.
    """
    from polls.models import Questionnaire
    from games.models import Quiz
    return (
        Questionnaire.objects.filter(owner=user).count()
        + Quiz.objects.filter(owner=user).count()
    )


def user_can_create_item(user):
    """True if the user has not exhausted their plan's hard item limit."""
    plan = get_effective_plan(user)
    if plan is None or plan.is_unlimited:
        return True
    return count_items_for_user(user) < plan.item_limit


def quota_required(view_func):
    """Decorator: block menti/game creation when free-tier limit is hit."""

    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        if not user_can_create_item(request.user):
            from django.contrib import messages
            messages.warning(
                request,
                "You've hit the 5-item limit on the Free plan. "
                "Upgrade to keep creating.",
            )
            return redirect("subscriptions:pricing")
        return view_func(request, *args, **kwargs)

    return wrapper
