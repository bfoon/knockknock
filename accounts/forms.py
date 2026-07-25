from django import forms
from django.contrib.auth.forms import AuthenticationForm, UserCreationForm
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

    def clean_email(self):
        """One account per email address (case-insensitive)."""
        email = (self.cleaned_data.get("email") or "").strip().lower()
        if not email:
            raise forms.ValidationError("Please enter an email address.")
        if User.objects.filter(email__iexact=email).exists():
            raise forms.ValidationError(
                "An account with this email already exists. "
                "Try logging in instead, or reset your password."
            )
        return email

    def clean_username(self):
        """
        Reject a username that is already taken, and reject a username that is
        identical to somebody else's email address — otherwise login would be
        ambiguous.
        """
        username = (self.cleaned_data.get("username") or "").strip()
        if User.objects.filter(username__iexact=username).exists():
            raise forms.ValidationError("That username is already taken.")
        if "@" in username and User.objects.filter(email__iexact=username).exists():
            raise forms.ValidationError(
                "That username is already in use as an account email address."
            )
        return username

    def save(self, commit=True):
        user = super().save(commit=False)
        # clean_email() already normalised this to lowercase.
        user.email = self.cleaned_data["email"]
        if commit:
            user.save()
        return user


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


class EmailOrUsernameAuthenticationForm(AuthenticationForm):
    """
    Login form that accepts a username *or* an email address.

    The field is still named `username`, so existing login templates keep
    working unchanged — only the label and placeholder differ.
    """

    error_messages = {
        **AuthenticationForm.error_messages,
        "invalid_login": (
            "Please enter a correct username or email address and password. "
            "Note that both fields may be case-sensitive."
        ),
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["username"].label = "Username or email"
        self.fields["username"].widget.attrs.update({
            "class": "form-control form-control-lg",
            "autofocus": True,
            "autocomplete": "username",
            "placeholder": "Username or email",
        })
        self.fields["password"].widget.attrs.update({
            "class": "form-control form-control-lg",
            "autocomplete": "current-password",
            "placeholder": "Password",
        })


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
