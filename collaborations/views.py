from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.http import HttpResponseForbidden
from django.shortcuts import get_object_or_404, redirect, render

from .forms import InviteCollaboratorForm
from .models import Collaborator, CollaborationInvite
from .services import send_collaboration_invite_email


@login_required
def invite(request, kind, target_id):
    """Show + handle the invite form for a menti or game."""
    if kind not in (CollaborationInvite.KIND_MENTI, CollaborationInvite.KIND_GAME):
        return HttpResponseForbidden("Unknown invite kind.")

    # Verify the user owns the target
    target = _load_owned_target(request.user, kind, target_id)
    if target is None:
        return HttpResponseForbidden("You don't own this resource.")

    # Resolve org context (team / corporate) if any
    membership = request.user.active_membership()
    org = membership.organization if membership else None

    if request.method == "POST":
        form = InviteCollaboratorForm(request.POST, org=org)
        if form.is_valid():
            email = form.cleaned_data["resolved_email"]
            inv = CollaborationInvite.objects.create(
                inviter=request.user,
                invitee_email=email.lower(),
                kind=kind,
                target_id=target_id,
                permission=form.cleaned_data["permission"],
                message=form.cleaned_data.get("message") or "",
            )
            send_collaboration_invite_email(inv, request=request)
            messages.success(request, f"Invite sent to {email}.")
            return redirect(request.path)
    else:
        form = InviteCollaboratorForm(org=org)

    existing_invites = CollaborationInvite.objects.filter(
        inviter=request.user, kind=kind, target_id=target_id,
    ).order_by("-created_at")

    return render(request, "collaborations/invite.html", {
        "form": form, "target": target, "kind": kind,
        "org": org, "invites": existing_invites,
    })


def _load_owned_target(user, kind, target_id):
    if kind == CollaborationInvite.KIND_MENTI:
        from polls.models import Questionnaire
        return Questionnaire.objects.filter(pk=target_id, owner=user).first()
    from games.models import Quiz
    return Quiz.objects.filter(pk=target_id, owner=user).first()


def accept(request, token):
    """Accept an invite. If not logged in, route to login/signup carrying the token."""
    inv = get_object_or_404(CollaborationInvite, token=token, status=CollaborationInvite.STATUS_PENDING)

    if not request.user.is_authenticated:
        request.session["pending_invite_token"] = token
        messages.info(request, "Sign in (or create an account) to accept your invite.")
        return redirect("accounts:login")

    if request.user.email.lower() != inv.invitee_email.lower():
        # Soft check: the invite was for a specific email
        messages.warning(
            request,
            "This invite was sent to a different email. Ask the inviter to re-send "
            "it to the address on your Knock-Knock account.",
        )
        return redirect("core:dashboard")

    inv.accept(request.user)
    Collaborator.objects.get_or_create(
        user=request.user,
        kind=inv.kind,
        target_id=inv.target_id,
        defaults={"permission": inv.permission},
    )
    messages.success(request, "You're in! Welcome to the collaboration. 🎉")
    target = inv.get_target()
    if target is None:
        return redirect("core:dashboard")
    if inv.kind == CollaborationInvite.KIND_MENTI:
        return redirect("polls:edit", target.pk)
    return redirect("games:edit", target.pk)
