"""
SKETCH — drop this into your accounts app (or merge into your existing
signup view). The names must match what `services.py` reverses:
    accounts:signup_with_invite   →  /signup/invite/<token>/
    accounts:login

Two pieces:
  1. `signup_with_invite(request, token)` — entry point from the email link.
     Loads the invite, pre-fills email, stashes token, hands off to signup.
  2. After signup completes, call `consume_pending_invite(request)` and
     return its result if it's not None.

Adjust to your actual signup form / auth backend.
"""

from django.contrib import messages
from django.contrib.auth import login
from django.shortcuts import get_object_or_404, redirect, render

from collaborations.invite_signup import (
    stash_pending_invite,
    consume_pending_invite,
)
from collaborations.models import CollaborationInvite
# from .forms import SignupForm  # ← your existing form


def signup_with_invite(request, token):
    """Entry point hit from the email link for users who don't have an account."""
    inv = get_object_or_404(
        CollaborationInvite, token=token, status=CollaborationInvite.STATUS_PENDING,
    )
    if inv.is_expired():
        inv.mark_expired()
        messages.error(request, "This invite has expired. Ask the sender to re-send it.")
        return redirect("accounts:signup")

    stash_pending_invite(request, token)

    # If they actually already have an account (e.g. they signed up between
    # invite send and click), send them to login with the token preserved.
    from django.contrib.auth import get_user_model
    User = get_user_model()
    if User.objects.filter(email__iexact=inv.invitee_email).exists():
        return redirect("accounts:login")

    # Pre-fill the email and lock it so they can't sign up under a different
    # address (the accept step would reject the mismatch anyway, but this is
    # friendlier).
    initial = {"email": inv.invitee_email}
    form = SignupForm(initial=initial)  # noqa: F821 — your form
    form.fields["email"].disabled = True

    return render(request, "accounts/signup.html", {
        "form": form,
        "invite": inv,
        "inviter": inv.inviter,
    })


# In your normal signup-completion code path, after the user is created and
# logged in, do this:
#
#   user = form.save()
#   login(request, user)
#   redirect_response = consume_pending_invite(request)
#   if redirect_response is not None:
#       return redirect_response
#   return redirect("core:dashboard")
#
# That's the whole handoff. consume_pending_invite handles expiry, email
# mismatch, Collaborator creation, and the right post-accept redirect.
