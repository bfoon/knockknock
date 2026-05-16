from django import forms

from .venue_models import Venue, SiteSetting


class VenueForm(forms.ModelForm):
    class Meta:
        model = Venue
        fields = ("name", "address", "latitude", "longitude",
                  "default_radius_m", "notes")
        widgets = {
            "name": forms.TextInput(attrs={
                "class": "form-control", "placeholder": "e.g. HQ Auditorium",
            }),
            "address": forms.TextInput(attrs={
                "class": "form-control",
                "placeholder": "Street, city — shown to organizers in the picker",
            }),
            "latitude": forms.NumberInput(attrs={
                "class": "form-control", "step": "any",
                "placeholder": "e.g. 13.4549",
            }),
            "longitude": forms.NumberInput(attrs={
                "class": "form-control", "step": "any",
                "placeholder": "e.g. -16.5790",
            }),
            "default_radius_m": forms.NumberInput(attrs={
                "class": "form-control", "min": 25, "max": 5000,
                "placeholder": "Default 150",
            }),
            "notes": forms.Textarea(attrs={
                "class": "form-control", "rows": 2,
                "placeholder": "Anything organizers should know — "
                               "parking, entry door, accessibility…",
            }),
        }

    def clean_default_radius_m(self):
        r = self.cleaned_data.get("default_radius_m")
        if r is not None and r < 25:
            raise forms.ValidationError(
                "Radius must be at least 25 m — phone GPS routinely drifts that much."
            )
        return r


class SiteSettingForm(forms.ModelForm):
    class Meta:
        model = SiteSetting
        fields = ("default_geofence_radius_m",)
        widgets = {
            "default_geofence_radius_m": forms.NumberInput(attrs={
                "class": "form-control", "min": 25, "max": 5000,
            }),
        }
