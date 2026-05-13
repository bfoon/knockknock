from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.http import HttpResponseForbidden
from django.shortcuts import get_object_or_404, redirect, render

from .forms import InviteCollaboratorForm
from .invite_signup import _grant_access
from .models import CollaborationInvite
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

    form_kwargs = {"org": org, "user": request.user, "kind": kind, "target_id": target_id}

    if request.method == "POST":
        form = InviteCollaboratorForm(request.POST, **form_kwargs)
        if form.is_valid():
            email = form.cleaned_data["resolved_email"]
            inv = CollaborationInvite.objects.create(
                inviter=request.user,
                invitee_email=email,  # already lowercased by form / model.save
                kind=kind,
                target_id=target_id,
                permission=form.cleaned_data["permission"],
                message=form.cleaned_data.get("message") or "",
            )
            send_collaboration_invite_email(inv, request=request)
            messages.success(request, f"Invite sent to {email}.")
            return redirect(request.path)
    else:
        form = InviteCollaboratorForm(**form_kwargs)

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
    inv = get_object_or_404(
        CollaborationInvite, token=token, status=CollaborationInvite.STATUS_PENDING,
    )

    # Expiry check — flip the row to EXPIRED so it doesn't keep showing as pending.
    if inv.is_expired():
        inv.mark_expired()
        messages.error(
            request,
            "This invite has expired. Ask the sender to re-send it.",
        )
        return redirect("core:dashboard")

    if not request.user.is_authenticated:
        request.session["pending_invite_token"] = token
        messages.info(request, "Sign in (or create an account) to accept your invite.")
        return redirect("accounts:login")

    if request.user.email.lower() != inv.invitee_email.lower():
        # Hard reject: invalidate the invite and require a fresh send. This
        # prevents a recipient from forwarding the link to someone else.
        inv.mark_declined()
        messages.error(
            request,
            "This invite was sent to a different email and is no longer valid. "
            "Ask the sender to re-send it to the address on your Knock-Knock account.",
        )
        return redirect("core:dashboard")

    _grant_access(inv, request.user)
    messages.success(request, "You're in! Welcome to the collaboration. 🎉")
    target = inv.get_target()
    if target is None:
        return redirect("core:dashboard")
    if inv.kind == CollaborationInvite.KIND_MENTI:
        return redirect("polls:edit", target.pk)
    return redirect("games:edit", target.pk)