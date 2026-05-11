from django import forms

from .models import Plan


class MockCheckoutForm(forms.Form):
    """Fake card form. NEVER use this in production — purely for testing."""

    cardholder_name = forms.CharField(
        max_length=120,
        widget=forms.TextInput(attrs={
            "class": "form-control form-control-lg",
            "placeholder": "Jane Q. Doe",
            "autocomplete": "off",
        }),
    )
    card_number = forms.CharField(
        min_length=12, max_length=19,
        widget=forms.TextInput(attrs={
            "class": "form-control form-control-lg",
            "placeholder": "4242 4242 4242 4242",
            "inputmode": "numeric",
            "autocomplete": "off",
        }),
    )
    expiry = forms.CharField(
        max_length=5,
        widget=forms.TextInput(attrs={
            "class": "form-control form-control-lg",
            "placeholder": "MM/YY",
            "autocomplete": "off",
        }),
    )
    cvc = forms.CharField(
        min_length=3, max_length=4,
        widget=forms.TextInput(attrs={
            "class": "form-control form-control-lg",
            "placeholder": "123",
            "autocomplete": "off",
        }),
    )

    def clean_card_number(self):
        raw = self.cleaned_data["card_number"].replace(" ", "")
        if not raw.isdigit():
            raise forms.ValidationError("Card number must be digits only.")
        return raw

    @property
    def last4(self):
        return self.cleaned_data["card_number"][-4:]
