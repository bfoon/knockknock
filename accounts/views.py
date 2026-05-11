from django.contrib import messages
from django.contrib.auth import login
from django.contrib.auth.decorators import login_required
from django.shortcuts import get_object_or_404, render, redirect
from django.utils import timezone
from datetime import timedelta

from subscriptions.models import Plan, Subscription

from .forms import (
    CorporateSignupForm,
    IndividualSignupForm,
    ProfileForm,
    SignupForm,
    TeamSignupForm,
)


# ─── Legacy single-route signup (kept so existing links don't break) ───
def signup(request):
    """Backwards-compatible signup that defaults to the Free plan."""
    return _signup_with_form(request, SignupForm, after_path="core:dashboard",
                             attach_free_plan=True)


# ─── Tier-specific signups ───────────────────────────────────
def signup_individual(request):
    """
    Used by both Free and Individual signup paths.
    The session's `pending_plan_tier` tells us which.
    """
    tier = request.session.get("pending_plan_tier", Plan.TIER_FREE)
    if tier == Plan.TIER_FREE:
        return _signup_with_form(
            request, IndividualSignupForm,
            after_path="core:dashboard",
            attach_free_plan=True,
            template="accounts/signup_individual.html",
            extra_ctx={"tier": tier, "is_free": True},
        )
    return _signup_with_form(
        request, IndividualSignupForm,
        after_path="subscriptions:checkout",
        attach_free_plan=False,
        template="accounts/signup_individual.html",
        extra_ctx={"tier": tier, "is_free": False},
    )


def signup_team(request):
    return _signup_with_form(
        request, TeamSignupForm,
        after_path="organizations:create",
        attach_free_plan=False,
        template="accounts/signup_team.html",
        extra_ctx={"tier": Plan.TIER_TEAM},
    )


def signup_corporate(request):
    return _signup_with_form(
        request, CorporateSignupForm,
        after_path="organizations:create",
        attach_free_plan=False,
        template="accounts/signup_corporate.html",
        extra_ctx={"tier": Plan.TIER_CORPORATE},
    )


# ─── Helpers ────────────────────────────────────────────────
def _signup_with_form(request, FormClass, *, after_path, attach_free_plan,
                      template="accounts/signup.html", extra_ctx=None):
    if request.method == "POST":
        form = FormClass(request.POST, request.FILES)
        if form.is_valid():
            user = form.save()
            # Optional profile image (only on IndividualSignupForm)
            image = form.cleaned_data.get("profile_image")
            if image and hasattr(user, "profile"):
                user.profile.logo = image
                user.profile.save()
            login(request, user)
            if attach_free_plan:
                free = Plan.objects.filter(tier=Plan.TIER_FREE).first()
                if free:
                    Subscription.objects.get_or_create(
                        user=user,
                        defaults=dict(plan=free, started_at=timezone.now()),
                    )
            messages.success(request, "Welcome to Knock-Knock! 🎉")
            # Handle pending collaboration invite token (signup_with_invite flow)
            redirected = _accept_pending_invite_if_any(request, user)
            if redirected:
                return redirected
            return redirect(after_path)
    else:
        form = FormClass()

    ctx = {"form": form}
    if extra_ctx:
        ctx.update(extra_ctx)
    return render(request, template, ctx)


def signup_with_invite(request, token):
    """
    Signup link from a collaboration email. Stashes the token, then runs
    individual signup. After signup we auto-accept the invite.
    """
    request.session["pending_invite_token"] = token
    # Default to free for these signups — they're being pulled in to collaborate
    request.session.setdefault("pending_plan_tier", Plan.TIER_FREE)
    return redirect("accounts:signup_individual")


def signup_to_org(request, membership_id):
    """
    Signup link from an org-invite email. Stores the membership ID so that
    after signup we attach the user to the org.
    """
    request.session["pending_org_membership_id"] = membership_id
    request.session.setdefault("pending_plan_tier", Plan.TIER_FREE)
    return redirect("accounts:signup_individual")


def _accept_pending_invite_if_any(request, user):
    """Auto-accept a pending collaboration or org invite, if one is stashed."""
    # Collaboration invite
    token = request.session.pop("pending_invite_token", None)
    if token:
        from collaborations.models import CollaborationInvite, Collaborator
        inv = CollaborationInvite.objects.filter(token=token).first()
        if inv and inv.status == CollaborationInvite.STATUS_PENDING:
            inv.accept(user)
            Collaborator.objects.get_or_create(
                user=user, kind=inv.kind, target_id=inv.target_id,
                defaults={"permission": inv.permission},
            )
            messages.success(request, "Invite accepted — you can now collaborate.")
            if inv.kind == CollaborationInvite.KIND_MENTI:
                return redirect("polls:edit", inv.target_id)
            return redirect("games:edit", inv.target_id)

    # Org membership invite
    membership_id = request.session.pop("pending_org_membership_id", None)
    if membership_id:
        from organizations.models import Membership
        m = Membership.objects.filter(pk=membership_id).first()
        if m and m.status == Membership.STATUS_INVITED:
            m.user = user
            m.status = Membership.STATUS_ACTIVE
            m.save()
            messages.success(request, f"You've joined {m.organization.name}.")
            return redirect("organizations:members", org_id=m.organization_id)

    return None


@login_required
def profile_view(request):
    from .models import Profile
    profile, _ = Profile.objects.get_or_create(
        user=request.user,
        defaults={"display_name": request.user.username},
    )
    if request.method == "POST":
        form = ProfileForm(request.POST, request.FILES, instance=profile)
        if form.is_valid():
            form.save()
            messages.success(request, "Profile updated.")
            return redirect("accounts:profile")
    else:
        form = ProfileForm(instance=profile)
    return render(request, "accounts/profile.html", {"form": form, "profile": profile})