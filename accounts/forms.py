from django import forms
from django.contrib.auth.forms import UserCreationForm
from django.contrib.auth.models import User
from .models import Profile


class _BaseSignupForm(UserCreationForm):
    email = forms.EmailField(required=True)

    class Meta:
        model = User
        fields = ("username", "email", "password1", "password2")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for field in self.fields.values():
            field.widget.attrs.update({"class": "form-control form-control-lg"})


# Kept for backward compatibility with the old single signup route
class SignupForm(_BaseSignupForm):
    pass


class IndividualSignupForm(_BaseSignupForm):
    """Individual + Free signup. Includes optional profile image."""

    profile_image = forms.ImageField(
        required=False,
        widget=forms.FileInput(attrs={"class": "form-control form-control-lg"}),
        help_text="Optional. PNG/JPG, square works best.",
    )


class TeamSignupForm(_BaseSignupForm):
    """User signup before they configure the team workspace.

    The org name + size is collected on the *next* page (organizations.create).
    """
    pass


class CorporateSignupForm(_BaseSignupForm):
    """User signup before they configure the corporate workspace."""
    pass


class ProfileForm(forms.ModelForm):
    class Meta:
        model = Profile
        fields = ("display_name", "logo", "brand_color", "bio")
        widgets = {
            "display_name": forms.TextInput(attrs={"class": "form-control"}),
            "logo": forms.FileInput(attrs={"class": "form-control"}),
            "brand_color": forms.TextInput(attrs={
                "class": "form-control form-control-color", "type": "color",
            }),
            "bio": forms.Textarea(attrs={"class": "form-control", "rows": 3}),
        }
