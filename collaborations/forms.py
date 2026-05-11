from django import forms

from organizations.models import Membership
from .models import CollaborationInvite


class InviteCollaboratorForm(forms.Form):
    """
    Invite someone to a menti or game.

    On Team/Corporate plans the form lets you pick from teammates OR enter an
    outside email — handled by passing `org` and using teammate_choice.
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

    def __init__(self, *args, org=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.org = org
        if org:
            teammates = (Membership.objects
                         .filter(organization=org, status=Membership.STATUS_ACTIVE)
                         .select_related("user"))
            self.fields["teammate"].choices = (
                [("", "— pick a teammate —")]
                + [(m.user.email, f"{m.user.username} ({m.get_role_display()})")
                   for m in teammates if m.user]
            )
        else:
            # No org → hide teammate field entirely
            self.fields.pop("teammate")

    def clean(self):
        cleaned = super().clean()
        email = (cleaned.get("email") or "").strip()
        teammate = (cleaned.get("teammate") or "").strip()
        if not email and not teammate:
            raise forms.ValidationError(
                "Pick a teammate or enter an email address."
            )
        if email and teammate:
            raise forms.ValidationError(
                "Use either a teammate OR an outside email, not both."
            )
        cleaned["resolved_email"] = email or teammate
        return cleaned
