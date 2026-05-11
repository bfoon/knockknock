from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from datetime import timedelta

from .forms import MockCheckoutForm
from .models import MockPayment, Plan, Subscription
from .services import get_effective_plan, get_effective_subscription


def pricing(request):
    """Public pricing page. Used both pre-signup and from inside the app."""
    plans = Plan.objects.all().order_by("price_monthly")
    current_plan = get_effective_plan(request.user) if request.user.is_authenticated else None
    return render(request, "subscriptions/pricing.html", {
        "plans": plans,
        "current_plan": current_plan,
    })


def choose_plan(request, tier):
    """
    Entry point from the pricing page. Routes to the right signup flow
    based on tier. Authenticated users go straight to checkout/upgrade.
    """
    plan = get_object_or_404(Plan, tier=tier)

    # Anonymous: send to the right signup form
    if not request.user.is_authenticated:
        request.session["pending_plan_tier"] = plan.tier
        if plan.tier == Plan.TIER_FREE:
            return redirect("accounts:signup_individual")  # free uses same form, no payment
        if plan.tier == Plan.TIER_INDIVIDUAL:
            return redirect("accounts:signup_individual")
        if plan.tier == Plan.TIER_TEAM:
            return redirect("accounts:signup_team")
        if plan.tier == Plan.TIER_CORPORATE:
            return redirect("accounts:signup_corporate")

    # Authenticated upgrade path
    if plan.tier == Plan.TIER_FREE:
        messages.info(request, "You can't downgrade to Free from here — contact support.")
        return redirect("subscriptions:pricing")
    if plan.tier == Plan.TIER_INDIVIDUAL:
        request.session["pending_plan_tier"] = plan.tier
        return redirect("subscriptions:checkout")
    if plan.tier in (Plan.TIER_TEAM, Plan.TIER_CORPORATE):
        request.session["pending_plan_tier"] = plan.tier
        return redirect("organizations:create")


@login_required
def checkout(request):
    """Mock checkout page. Reads pending tier from session."""
    tier = request.session.get("pending_plan_tier")
    if not tier:
        return redirect("subscriptions:pricing")
    plan = get_object_or_404(Plan, tier=tier)

    if request.method == "POST":
        form = MockCheckoutForm(request.POST)
        if form.is_valid():
            sub = _activate_personal_plan(request.user, plan)
            MockPayment.objects.create(
                subscription=sub,
                amount=plan.price_monthly,
                card_last4=form.last4,
                cardholder_name=form.cleaned_data["cardholder_name"],
                succeeded=True,
            )
            request.session.pop("pending_plan_tier", None)
            messages.success(
                request,
                f"🎉 You're now on the {plan.name} plan. (No real card was charged — this is a mock.)",
            )
            return redirect("core:dashboard")
    else:
        form = MockCheckoutForm()

    return render(request, "subscriptions/checkout.html", {
        "form": form, "plan": plan,
    })


def _activate_personal_plan(user, plan):
    """Create or update the user's personal subscription."""
    sub, _ = Subscription.objects.update_or_create(
        user=user,
        defaults=dict(
            plan=plan,
            status=Subscription.STATUS_ACTIVE,
            started_at=timezone.now(),
            renews_at=timezone.now() + timedelta(days=30),
            organization=None,
        ),
    )
    return sub


@login_required
def manage(request):
    """Show the user their current plan and recent payments."""
    sub = get_effective_subscription(request.user)
    payments = sub.payments.all().order_by("-created_at")[:10] if sub else []
    return render(request, "subscriptions/manage.html", {
        "subscription": sub, "payments": payments,
    })


@login_required
def cancel(request):
    sub = getattr(request.user, "kk_subscription", None)
    if request.method == "POST" and sub:
        sub.status = Subscription.STATUS_CANCELLED
        sub.save()
        # Drop them back to Free
        free = Plan.objects.get(tier=Plan.TIER_FREE)
        _activate_personal_plan(request.user, free)
        messages.info(request, "Subscription cancelled. You're back on the Free plan.")
        return redirect("subscriptions:manage")
    return render(request, "subscriptions/cancel_confirm.html", {"subscription": sub})
