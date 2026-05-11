from django import forms

from .models import Membership, Organization


class TeamSignupForm(forms.Form):
    """Used after user signup to create the Team org (≤10 members)."""

    organization_name = forms.CharField(
        max_length=120,
        widget=forms.TextInput(attrs={
            "class": "form-control form-control-lg",
            "placeholder": "Acme Marketing Team",
        }),
    )
    team_size = forms.IntegerField(
        min_value=1, max_value=10,
        widget=forms.NumberInput(attrs={
            "class": "form-control form-control-lg",
            "placeholder": "How many people on your team? (max 10)",
        }),
        help_text="You'll invite them on the next step. Max 10 members on the Team plan.",
    )


class CorporateSignupForm(forms.Form):
    """Used after user signup to create a Corporate org (>10 members)."""

    organization_name = forms.CharField(
        max_length=120,
        widget=forms.TextInput(attrs={
            "class": "form-control form-control-lg",
            "placeholder": "Acme Corporation",
        }),
    )
    expected_members = forms.IntegerField(
        min_value=11,
        widget=forms.NumberInput(attrs={
            "class": "form-control form-control-lg",
            "placeholder": "Estimated number of members",
        }),
        help_text="Corporate plans support unlimited members — this just helps us provision support.",
    )


class InviteMemberForm(forms.Form):
    email = forms.EmailField(
        widget=forms.EmailInput(attrs={
            "class": "form-control",
            "placeholder": "[email protected]",
        }),
    )
    role = forms.ChoiceField(
        choices=Membership.ROLE_CHOICES,
        initial=Membership.ROLE_EDITOR,
        widget=forms.Select(attrs={"class": "form-select"}),
    )


class ChangeRoleForm(forms.ModelForm):
    class Meta:
        model = Membership
        fields = ("role",)
        widgets = {"role": forms.Select(attrs={"class": "form-select form-select-sm"})}
