from django import forms

from .venue_models import Venue, SiteSetting


class VenueForm(forms.ModelForm):
    """
    Create / edit a venue.

    The advertisement fields (`advertise`, `image`, `tagline`,
    `description`, contact info, website, sort order) only make sense
    for global venues edited by a superuser. The view passes
    `user=` into __init__ so we can strip those fields out for org
    admins editing their own org's venues — they can't promote a
    venue to the homepage, and the form shouldn't even hint at it.
    """

    ADVERTISE_FIELDS = (
        "advertise", "image", "tagline", "description",
        "contact_email", "contact_phone", "website_url", "advertise_order",
    )

    class Meta:
        model = Venue
        fields = (
            "name", "address", "latitude", "longitude",
            "default_radius_m", "notes",
            # Superuser-only fields below; non-superusers have these
            # popped in __init__ so they're never rendered or accepted.
            "advertise", "image", "tagline", "description",
            "contact_email", "contact_phone", "website_url", "advertise_order",
        )
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
            # Advertisement widgets
            "advertise": forms.CheckboxInput(attrs={
                "class": "form-check-input",
            }),
            "tagline": forms.TextInput(attrs={
                "class": "form-control",
                "placeholder": "One-line pitch shown on the homepage card",
            }),
            "description": forms.Textarea(attrs={
                "class": "form-control", "rows": 4,
                "placeholder": "Tell visitors what makes this venue great — "
                               "capacity, facilities, transport, parking…",
            }),
            "contact_email": forms.EmailInput(attrs={
                "class": "form-control",
                "placeholder": "bookings@venue.example",
            }),
            "contact_phone": forms.TextInput(attrs={
                "class": "form-control",
                "placeholder": "+220 ...",
            }),
            "website_url": forms.URLInput(attrs={
                "class": "form-control",
                "placeholder": "https://...",
            }),
            "advertise_order": forms.NumberInput(attrs={
                "class": "form-control", "min": 0,
            }),
        }

    def __init__(self, *args, **kwargs):
        # The view passes `user=request.user` so we can gate advertise
        # fields. `scope` ("global" / "org") is also passed so we know
        # whether we're editing a global row.
        self._user = kwargs.pop("user", None)
        self._scope = kwargs.pop("scope", None)
        super().__init__(*args, **kwargs)

        # Mark every advertise field optional at the form level — even
        # when rendered, they're never required to save a venue.
        for fname in self.ADVERTISE_FIELDS:
            if fname in self.fields:
                self.fields[fname].required = False

        # Strip advertise fields entirely for non-superusers, OR for
        # superusers editing an org-scoped venue (where advertise is
        # always ignored at save time anyway — see Venue.save).
        is_super = bool(getattr(self._user, "is_superuser", False))
        is_global_scope = (self._scope == "global") or (
            self.instance.pk and self.instance.is_global
        )
        if not (is_super and is_global_scope):
            for fname in self.ADVERTISE_FIELDS:
                self.fields.pop(fname, None)

    def clean_default_radius_m(self):
        r = self.cleaned_data.get("default_radius_m")
        if r is not None and r < 25:
            raise forms.ValidationError(
                "Radius must be at least 25 m — phone GPS routinely drifts that much."
            )
        return r

    def clean(self):
        cleaned = super().clean()
        # If they're enabling advertise, gently require at least an
        # image OR a description so the homepage card has *something*
        # to show. Without this, an empty card slips through and looks
        # broken on the public site.
        if cleaned.get("advertise"):
            has_image = bool(cleaned.get("image") or
                             (self.instance.pk and self.instance.image))
            has_desc = bool(cleaned.get("description") or cleaned.get("tagline"))
            if not (has_image or has_desc):
                self.add_error(
                    "advertise",
                    "To advertise this venue, add at least an image or a tagline / description.",
                )
        return cleaned


class SiteSettingForm(forms.ModelForm):
    class Meta:
        model = SiteSetting
        fields = ("default_geofence_radius_m",)
        widgets = {
            "default_geofence_radius_m": forms.NumberInput(attrs={
                "class": "form-control", "min": 25, "max": 5000,
            }),
        }