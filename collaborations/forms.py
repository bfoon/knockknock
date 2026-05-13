from django import forms

from organizations.models import Membership
from .models import CollaborationInvite


class InviteCollaboratorForm(forms.Form):
    """
    Invite someone to a menti or game.

    On Team/Corporate plans the form lets you pick from teammates OR enter an
    outside email. The teammate dropdown is server-validated against the user's
    org membership — submitting an arbitrary email in the teammate field is
    rejected, not silently accepted as an "outside" invite.

    Constructor args:
        org   — the inviter's active organization (or None for individual users)
        user  — the request user, used for self-invite + duplicate checks
        kind, target_id — needed to detect duplicate pending invites
    """

    email = forms.EmailField(
        required=False,
        widget=forms.EmailInput(attrs={
            "class": "form-control",
            "placeholder": "Outsider's email",
        }),
        help_text="Use this to invite someone outside your workspace.",
    )
    teammate = forms.ChoiceField(
        required=False,
        widget=forms.Select(attrs={"class": "form-select"}),
        choices=[("", "— pick a teammate —")],
    )
    permission = forms.ChoiceField(
        choices=CollaborationInvite.PERM_CHOICES,
        initial=CollaborationInvite.PERM_EDIT,
        widget=forms.Select(attrs={"class": "form-select"}),
    )
    message = forms.CharField(
        required=False,
        widget=forms.Textarea(attrs={
            "class": "form-control",
            "rows": 2,
            "placeholder": "Optional note…",
        }),
    )

    def __init__(self, *args, org=None, user=None, kind=None, target_id=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.org = org
        self.user = user
        self.kind = kind
        self.target_id = target_id

        # Build the allowed-teammate set on the server so POSTed values can be
        # validated against it (not just trusted).
        self._allowed_teammate_emails = set()

        if org:
            teammates = (Membership.objects
                         .filter(organization=org, status=Membership.STATUS_ACTIVE)
                         .select_related("user"))
            choices = [("", "— pick a teammate —")]
            for m in teammates:
                if not m.user:
                    continue
                # Don't list the inviter themselves.
                if user and m.user_id == user.id:
                    continue
                email = m.user.email.lower()
                self._allowed_teammate_emails.add(email)
                choices.append(
                    (email, f"{m.user.username} ({m.get_role_display()})")
                )
            self.fields["teammate"].choices = choices
        else:
            # No org → hide teammate field entirely
            self.fields.pop("teammate")

    def clean_teammate(self):
        """Reject teammate values that aren't in the inviter's active org."""
        value = (self.cleaned_data.get("teammate") or "").strip().lower()
        if not value:
            return ""
        if value not in self._allowed_teammate_emails:
            raise forms.ValidationError(
                "That person isn't a member of your workspace."
            )
        return value

    def clean(self):
        cleaned = super().clean()
        email = (cleaned.get("email") or "").strip().lower()
        teammate = (cleaned.get("teammate") or "").strip().lower()

        if not email and not teammate:
            raise forms.ValidationError(
                "Pick a teammate or enter an email address."
            )
        if email and teammate:
            raise forms.ValidationError(
                "Use either a teammate OR an outside email, not both."
            )

        resolved = email or teammate

        # Block self-invite (covers both the email field and a teammate row that
        # somehow matches the user — defensive belt-and-braces).
        if self.user and self.user.email and resolved == self.user.email.lower():
            raise forms.ValidationError("You can't invite yourself.")

        # Block duplicate pending invites for the same target. (Accepted, declined,
        # or expired invites don't block — the inviter can try again.)
        if self.kind and self.target_id:
            already = CollaborationInvite.objects.filter(
                kind=self.kind,
                target_id=self.target_id,
                invitee_email=resolved,
                status=CollaborationInvite.STATUS_PENDING,
            ).exists()
            if already:
                raise forms.ValidationError(
                    f"{resolved} already has a pending invite to this. "
                    "Wait for them to accept, or cancel the existing invite first."
                )

        cleaned["resolved_email"] = resolved
        return cleaned