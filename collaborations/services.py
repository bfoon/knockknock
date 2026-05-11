"""
Sending invite emails. Renders templates from templates/emails/.

Important behavior:
  - If invitee has a Knock-Knock account: email links straight to the accept URL.
  - If they don't: email links to signup with the token preserved, so accepting
    auto-runs after they create their account.
"""

from django.contrib.auth import get_user_model
from django.core.mail import send_mail
from django.template.loader import render_to_string
from django.urls import reverse

User = get_user_model()


def _absolute(request, path):
    if request is None:
        return path
    return request.build_absolute_uri(path)


def send_collaboration_invite_email(invite, request=None):
    """Send the right email depending on whether they already have an account."""
    has_account = User.objects.filter(email__iexact=invite.invitee_email).exists()
    target = invite.get_target()
    accept_path = invite.get_accept_url()

    if not has_account:
        # signup_with_invite captures the token in session and redirects after signup
        accept_path = reverse("accounts:signup_with_invite", kwargs={"token": invite.token})

    context = {
        "invite": invite,
        "target": target,
        "inviter": invite.inviter,
        "accept_url": _absolute(request, accept_path),
        "has_account": has_account,
    }
    template = ("emails/invite_existing_user.txt" if has_account
                else "emails/invite_new_user.txt")
    body = render_to_string(template, context)
    subject = f"{invite.inviter.username} invited you to collaborate on Knock-Knock"
    send_mail(subject, body, from_email=None, recipient_list=[invite.invitee_email])


def send_org_invite_email(membership, request=None):
    """Email an organization invite (Team/Corporate seat)."""
    has_account = bool(membership.user)
    accept_path = reverse("organizations:members", kwargs={"org_id": membership.organization_id})
    if not has_account:
        # Use the dedicated org-invite token path via accounts signup
        accept_path = reverse("accounts:signup_to_org",
                              kwargs={"membership_id": membership.id})
    context = {
        "membership": membership,
        "organization": membership.organization,
        "accept_url": _absolute(request, accept_path),
        "has_account": has_account,
    }
    template = ("emails/org_invite_existing.txt" if has_account
                else "emails/org_invite_new.txt")
    body = render_to_string(template, context)
    subject = f"You've been invited to {membership.organization.name} on Knock-Knock"
    send_mail(subject, body, from_email=None,
              recipient_list=[membership.invited_email or (membership.user and membership.user.email)])
