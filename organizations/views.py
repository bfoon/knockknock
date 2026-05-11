from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.http import HttpResponseForbidden
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from datetime import timedelta

from subscriptions.models import Plan, Subscription
from subscriptions.forms import MockCheckoutForm
from subscriptions.models import MockPayment

from .forms import ChangeRoleForm, CorporateSignupForm, InviteMemberForm, TeamSignupForm
from .models import Membership, Organization


@login_required
def create_organization(request):
    """
    Multi-step path that ends with creating an Organization, attaching a
    Subscription, and dropping the user into the org dashboard.

    Reads pending_plan_tier from session (set by subscriptions.choose_plan).
    """
    tier = request.session.get("pending_plan_tier")
    if tier not in (Plan.TIER_TEAM, Plan.TIER_CORPORATE):
        return redirect("subscriptions:pricing")
    plan = get_object_or_404(Plan, tier=tier)

    FormClass = TeamSignupForm if tier == Plan.TIER_TEAM else CorporateSignupForm

    if request.method == "POST":
        form = FormClass(request.POST)
        checkout = MockCheckoutForm(request.POST)
        if form.is_valid() and checkout.is_valid():
            org = Organization.objects.create(
                name=form.cleaned_data["organization_name"],
                kind=Organization.KIND_TEAM if tier == Plan.TIER_TEAM else Organization.KIND_CORPORATE,
                owner=request.user,
            )
            sub = Subscription.objects.create(
                organization=org,
                plan=plan,
                status=Subscription.STATUS_ACTIVE,
                started_at=timezone.now(),
                renews_at=timezone.now() + timedelta(days=30),
            )
            MockPayment.objects.create(
                subscription=sub,
                amount=plan.price_monthly,
                card_last4=checkout.last4,
                cardholder_name=checkout.cleaned_data["cardholder_name"],
                succeeded=True,
            )
            # Owner becomes Admin automatically
            Membership.objects.create(
                organization=org,
                user=request.user,
                role=Membership.ROLE_ADMIN,
                status=Membership.STATUS_ACTIVE,
            )
            request.session.pop("pending_plan_tier", None)
            messages.success(
                request,
                f"🎉 {org.name} is live on the {plan.name} plan. Invite your team next.",
            )
            return redirect("organizations:members", org_id=org.pk)
    else:
        form = FormClass()
        checkout = MockCheckoutForm()

    return render(request, "organizations/create.html", {
        "form": form, "checkout_form": checkout, "plan": plan, "tier": tier,
    })


def _require_membership(user, org_id, *, must_be_admin=False):
    """Return (organization, membership) or raise 403."""
    org = get_object_or_404(Organization, pk=org_id)
    membership = Membership.objects.filter(
        organization=org, user=user, status=Membership.STATUS_ACTIVE
    ).first()
    if not membership:
        return None, None
    if must_be_admin and not membership.can_change_roles():
        return None, None
    return org, membership


@login_required
def members(request, org_id):
    org, me = _require_membership(request.user, org_id)
    if not me:
        return HttpResponseForbidden("You're not a member of this organization.")

    if request.method == "POST" and me.can_invite():
        invite_form = InviteMemberForm(request.POST)
        if invite_form.is_valid():
            if not org.has_open_seat():
                messages.error(
                    request,
                    f"Your {org.get_kind_display()} plan is full ({org.seat_limit} seats).",
                )
            else:
                _invite_member_to_org(org, invite_form.cleaned_data["email"],
                                      invite_form.cleaned_data["role"], request)
                messages.success(request, f"Invite sent to {invite_form.cleaned_data['email']}.")
            return redirect("organizations:members", org_id=org.pk)
    else:
        invite_form = InviteMemberForm()

    memberships = org.memberships.exclude(status=Membership.STATUS_REMOVED).select_related("user")

    return render(request, "organizations/members.html", {
        "organization": org, "me": me,
        "memberships": memberships, "invite_form": invite_form,
    })


def _invite_member_to_org(org, email, role, request):
    """Create an Invited Membership and (if account exists) link user."""
    from django.contrib.auth import get_user_model
    User = get_user_model()
    existing = User.objects.filter(email__iexact=email).first()

    membership, created = Membership.objects.get_or_create(
        organization=org,
        invited_email=email.lower(),
        defaults=dict(role=role, status=Membership.STATUS_INVITED),
    )
    if not created:
        membership.role = role
        membership.save()

    if existing:
        membership.user = existing
        membership.status = Membership.STATUS_ACTIVE
        membership.save()

    # Side-effect: send email (handled by collaborations app helper)
    from collaborations.services import send_org_invite_email
    send_org_invite_email(membership, request=request)


@login_required
def change_role(request, org_id, membership_id):
    org, me = _require_membership(request.user, org_id, must_be_admin=True)
    if not me:
        return HttpResponseForbidden("Admins only.")
    target = get_object_or_404(Membership, pk=membership_id, organization=org)
    if target.user_id == org.owner_id:
        messages.error(request, "Can't change the owner's role.")
        return redirect("organizations:members", org_id=org.pk)
    if request.method == "POST":
        form = ChangeRoleForm(request.POST, instance=target)
        if form.is_valid():
            form.save()
            messages.success(request, f"Updated {target} to {target.get_role_display()}.")
    return redirect("organizations:members", org_id=org.pk)


@login_required
def remove_member(request, org_id, membership_id):
    org, me = _require_membership(request.user, org_id, must_be_admin=True)
    if not me:
        return HttpResponseForbidden("Admins only.")
    target = get_object_or_404(Membership, pk=membership_id, organization=org)
    if target.user_id == org.owner_id:
        messages.error(request, "Can't remove the owner.")
    elif request.method == "POST":
        target.status = Membership.STATUS_REMOVED
        target.save()
        messages.info(request, f"Removed {target}.")
    return redirect("organizations:members", org_id=org.pk)
