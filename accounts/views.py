from django.contrib import messages
from django.contrib.auth import login, logout as auth_logout
from django.contrib.auth.decorators import login_required
from django.shortcuts import get_object_or_404, render, redirect
from django.utils import timezone
from django.views.decorators.http import require_POST
from datetime import timedelta

from subscriptions.models import Plan, Subscription

from .forms import (
    CorporateSignupForm,
    IndividualSignupForm,
    ProfileForm,
    SignupForm,
    TeamSignupForm,
)
from .models import Profile, UserSession

# With more than one entry in settings.AUTHENTICATION_BACKENDS, login() must be
# told which backend the user was "authenticated" with, because form.save()
# never sets user.backend.
AUTH_BACKEND = "accounts.backends.EmailOrUsernameModelBackend"


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
            # backend= is required: multiple AUTHENTICATION_BACKENDS configured
            login(request, user, backend=AUTH_BACKEND)
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
    """Auto-accept a pending collaboration, Hanns deck, or org invite, if one is stashed."""
    # Hanns live-edit invite
    hanns_token = request.session.pop("pending_hanns_invite_token", None)
    if hanns_token:
        from hanns.models import DeckInvite
        inv = DeckInvite.objects.filter(token=hanns_token).select_related("deck").first()
        if inv and inv.status == DeckInvite.STATUS_PENDING:
            if (user.email or "").lower() == inv.email.lower():
                inv.accept(user)
                messages.success(request, "Invite accepted — you can now live-edit the presentation.")
                return redirect("hanns:edit", inv.deck.code)
            messages.error(request, "This presentation invite was sent to a different email address.")
            return redirect("core:dashboard")

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


# ─── Profile + signed-in devices ─────────────────────────────
@login_required
def profile_view(request):
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

    sessions, current_key = _sessions_for(request)
    return render(request, "accounts/profile.html", {
        "form": form,
        "profile": profile,
        "sessions": sessions,
        "current_session_key": current_key,
        "other_session_count": sum(1 for s in sessions if s.session_key != current_key),
    })


def _sessions_for(request):
    """Live sessions for this user, current one first, dead rows pruned."""
    current_key = request.session.session_key
    # A session that predates this feature has no row yet — adopt it so the
    # device the person is looking at is never missing from the list.
    if current_key and not UserSession.objects.filter(session_key=current_key).exists():
        UserSession.record(request, request.user)

    sessions = list(UserSession.objects.filter(user=request.user).alive())
    sessions.sort(key=lambda s: (s.session_key != current_key, -s.last_seen.timestamp()))
    return sessions, current_key


@login_required
@require_POST
def session_end(request):
    """Sign out one device. Ending your own session logs you out here."""
    key = (request.POST.get("key") or "").strip()
    target = UserSession.objects.filter(user=request.user, session_key=key).first()
    if not target:
        messages.error(request, "That session has already ended.")
        return redirect("accounts:profile")

    device = target.device or "that device"

    if key == request.session.session_key:
        # Don't delete the store we are currently serving from — Django's
        # SessionMiddleware raises SessionInterrupted (HTTP 400) when the
        # session vanishes mid-request. logout() flushes it cleanly, and
        # the user_logged_out receiver drops the row for us.
        auth_logout(request)
        messages.success(request, "Signed out.")
        return redirect("accounts:login")

    target.end()
    messages.success(request, f"Signed out of {device}.")
    return redirect("accounts:profile")


@login_required
@require_POST
def session_end_others(request):
    """Sign out everywhere except the device making this request."""
    current_key = request.session.session_key
    ended = 0
    for s in UserSession.objects.filter(user=request.user).exclude(session_key=current_key):
        s.end()
        ended += 1
    if ended:
        messages.success(request, f"Signed out of {ended} other device(s).")
    else:
        messages.info(request, "You're not signed in anywhere else.")
    return redirect("accounts:profile")
