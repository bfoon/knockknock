"""
Who may publish straight to the home page, and who goes through review.

The rule you asked for: free plan is reviewed, a paid plan is instant.

This module deliberately does NOT import the subscriptions app. KnockKnock's
subscription model can change shape without breaking publishing, and the
publish app stays installable on its own. Resolution order:

1. settings.PUBLISH_PLAN_RESOLVER  -- dotted path to your own callable(user) -> str
2. duck-typing across the usual places a plan hides
3. "free"

Override in settings.py once you know the field, for example:

    PUBLISH_PLAN_RESOLVER = "subscriptions.helpers.plan_code_for"
    PUBLISH_INSTANT_PLANS = ["pro", "team", "school", "enterprise"]
"""

from django.conf import settings
from django.utils.module_loading import import_string

FREE = "free"

DEFAULT_INSTANT_PLANS = ["pro", "plus", "team", "school", "business", "enterprise", "paid"]


def _instant_plans():
    return [p.lower() for p in getattr(settings, "PUBLISH_INSTANT_PLANS", DEFAULT_INSTANT_PLANS)]


def _from_setting(user):
    path = getattr(settings, "PUBLISH_PLAN_RESOLVER", None)
    if not path:
        return None
    try:
        return import_string(path)(user)
    except Exception:
        return None


def _duck(user):
    """Look in the places a plan code normally lives, without importing anything."""
    candidates = []
    for attr in ("subscription", "usersubscription", "membership", "profile"):
        obj = getattr(user, attr, None)
        if obj is None:
            continue
        for field in ("plan_code", "plan", "tier", "level", "product"):
            val = getattr(obj, field, None)
            if val is None:
                continue
            candidates.append(getattr(val, "code", None) or getattr(val, "slug", None) or val)
    for field in ("plan_code", "plan", "tier"):
        val = getattr(user, field, None)
        if val is not None:
            candidates.append(val)
    for val in candidates:
        code = str(val).strip().lower()
        if code:
            return code
    return None


def user_plan(user):
    """Return a lowercase plan code. Anonymous and unknown both read as free."""
    if not getattr(user, "is_authenticated", False):
        return FREE
    for resolver in (_from_setting, _duck):
        code = resolver(user)
        if code:
            return str(code).strip().lower()
    return FREE


def is_paid(user):
    plan = user_plan(user)
    if plan in _instant_plans():
        return True
    # Anything that isn't the free code but is a known active subscription still
    # counts as paid, so a new plan code doesn't silently demote a paying user.
    return plan not in (FREE, "", "none", "basic", "starter")


def can_publish_instantly(user):
    """True -> Publish puts it live. False -> Publish sends it for review."""
    if not getattr(user, "is_authenticated", False):
        return False
    if user.is_staff and getattr(settings, "PUBLISH_INSTANT_FOR_STAFF", True):
        return True
    if getattr(settings, "PUBLISH_EVERYONE_INSTANT", False):
        return True
    return is_paid(user)


def can_review(user):
    """Who works the review queue."""
    if not getattr(user, "is_authenticated", False):
        return False
    if user.is_superuser or user.is_staff:
        return True
    return user.has_perm("publish.change_publication")


def publish_gate(user):
    """Everything a template needs to explain the button before it is pressed."""
    instant = can_publish_instantly(user)
    return {
        "plan": user_plan(user),
        "instant": instant,
        "button_label": "Publish" if instant else "Send for review",
        "explainer": (
            "Your publication goes live as soon as you press publish."
            if instant else
            "Publications on the free plan are read by an editor before they appear "
            "on the home page. You will get a note either way."
        ),
    }
