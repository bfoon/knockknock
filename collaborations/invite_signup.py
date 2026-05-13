"""
Bridge between accounts signup and invite acceptance, and between the
generic collaborations app and the per-app collaborator tables that the
rest of the codebase reads from (polls.QuestionnaireCollaborator and,
later, the games equivalent).

Why the sync helper?
  polls.Questionnaire.can_edit() reads from QuestionnaireCollaborator, not
  from collaborations.Collaborator. To keep that working unchanged, every
  invite acceptance must write to BOTH tables. _sync_app_collaborator()
  below is the single place that rule lives.
"""

from django.shortcuts import redirect

from .models import Collaborator, CollaborationInvite


# ─── Cross-app sync ──────────────────────────────────────────────────

def _sync_app_collaborator(inv, user):
    """
    Create the per-app collaborator row that matches an accepted invite,
    so the owning app's permission checks (e.g. Questionnaire.can_edit)
    see the new collaborator.

    Idempotent — uses get_or_create. Safe to call from anywhere.
    """
    if inv.kind == CollaborationInvite.KIND_MENTI:
        from polls.models import Questionnaire, QuestionnaireCollaborator
        questionnaire = Questionnaire.objects.filter(pk=inv.target_id).first()
        if questionnaire is None:
            return
        QuestionnaireCollaborator.objects.get_or_create(
            questionnaire=questionnaire,
            user=user,
            defaults={
                "role": inv.permission,            # "edit" / "view" map 1:1
                "invited_by": inv.inviter,
            },
        )
    elif inv.kind == CollaborationInvite.KIND_GAME:
        # The games app has its own collaborator model with the same shape.
        # When it lands, mirror the polls block above. Until then this is a
        # no-op so accepting a game invite still writes the generic row.
        try:
            from games.models import Quiz, QuizCollaborator  # noqa: F401
        except ImportError:
            return
        quiz = Quiz.objects.filter(pk=inv.target_id).first()
        if quiz is None:
            return
        QuizCollaborator.objects.get_or_create(
            quiz=quiz,
            user=user,
            defaults={"role": inv.permission, "invited_by": inv.inviter},
        )


def _grant_access(inv, user):
    """Run the full 'accepted' side-effect: mark invite, create both rows."""
    inv.accept(user)
    Collaborator.objects.get_or_create(
        user=user,
        kind=inv.kind,
        target_id=inv.target_id,
        defaults={"permission": inv.permission},
    )
    _sync_app_collaborator(inv, user)


# ─── Signup → accept handoff ─────────────────────────────────────────

def stash_pending_invite(request, token):
    """Call from `signup_with_invite` before rendering the signup form."""
    request.session["pending_invite_token"] = token


def peek_pending_invite(request):
    """Return the pending invite for this session if any (without consuming it).

    Returns None if there isn't one, or if the stashed token no longer points
    to a valid pending invite.
    """
    token = request.session.get("pending_invite_token")
    if not token:
        return None
    inv = CollaborationInvite.objects.filter(
        token=token, status=CollaborationInvite.STATUS_PENDING,
    ).first()
    if inv is None or inv.is_expired():
        # Clean up so we don't keep looking it up.
        request.session.pop("pending_invite_token", None)
        if inv is not None:
            inv.mark_expired()
        return None
    return inv


def consume_pending_invite(request):
    """
    Call from your signup view AFTER the new user is created and logged in.

    Returns an HttpResponseRedirect to the right next page if there was a
    pending invite (whether or not it was accepted), or None if there was none.

    The decision tree mirrors `views.accept` exactly so behavior is consistent
    whether the user clicks the accept link logged-in or signs up from it.
    """
    from django.contrib import messages

    inv = peek_pending_invite(request)
    if inv is None:
        return None

    # Always pop the token now that we're acting on it.
    request.session.pop("pending_invite_token", None)

    if not request.user.is_authenticated:
        # Shouldn't happen if called post-signup, but bail safely.
        return None

    # Email mismatch → hard reject (same rule as the accept view).
    if request.user.email.lower() != inv.invitee_email.lower():
        inv.mark_declined()
        messages.error(
            request,
            "Your account email doesn't match the invite. Ask the sender to "
            "re-send it to the address you signed up with.",
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