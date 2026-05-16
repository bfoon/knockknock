"""
Forms.

Three forms here:

  EventForm
    Standard ModelForm for the organizer to create/edit an event.

  EventFieldForm
    For the organizer to edit one form field's settings (label, required,
    options, etc.). The drag-to-reorder happens in JS — the order field
    gets saved via the AJAX reorder endpoint, not this form.

  DynamicRegistrationForm
    The attendee-facing form. Fields are constructed at runtime from
    event.fields.all() so adding a new EventField in the admin
    "just works" without form code changes.
"""

from django import forms
from django.core.exceptions import ValidationError

from .models import AttendanceEvent, EventField, AgendaItem


# ───────────────────────── Organizer-side ─────────────────────────

class EventForm(forms.ModelForm):
    # HTML5 <input type="datetime-local"> submits values like
    # "2026-05-20T14:30" — no seconds, no timezone. Django's default
    # DateTimeField input_formats don't include this, so we add it
    # explicitly on each datetime field below in __init__. Without this
    # the form silently fails validation with "Enter a valid date/time."
    DATETIME_LOCAL_FORMATS = [
        "%Y-%m-%dT%H:%M",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
    ]

    class Meta:
        model = AttendanceEvent
        fields = (
            "title", "description", "agenda", "cover_image",
            "location", "is_online", "online_url",
            "starts_at", "ends_at", "timezone_name",
            "capacity", "registration_mode", "registration_closes_at",
            "allow_walk_ins",
            # Geofence
            "require_geofence", "geofence_lat", "geofence_lng", "geofence_radius_m",
            # Agenda visual style
            "agenda_template_key",
            # Certificate
            "generate_certificates", "certificate_template_key",
            "certificate_logo",
            "certificate_logo_x_pct", "certificate_logo_y_pct",
            "certificate_logo_width_pct",
        )
        widgets = {
            "starts_at": forms.DateTimeInput(
                attrs={"type": "datetime-local", "class": "form-control"},
                format="%Y-%m-%dT%H:%M",
            ),
            "ends_at": forms.DateTimeInput(
                attrs={"type": "datetime-local", "class": "form-control"},
                format="%Y-%m-%dT%H:%M",
            ),
            "registration_closes_at": forms.DateTimeInput(
                attrs={"type": "datetime-local", "class": "form-control"},
                format="%Y-%m-%dT%H:%M",
            ),
            "description": forms.Textarea(attrs={"rows": 3, "class": "form-control"}),
            "agenda": forms.Textarea(attrs={"rows": 6, "class": "form-control"}),
            # Geofence — these are technically optional; the wider UI in
            # event_form.html gates them behind the `require_geofence` toggle
            # and adds a "use my current location" button.
            "geofence_lat": forms.NumberInput(attrs={
                "class": "form-control", "step": "any",
                "placeholder": "e.g. 13.4549",
            }),
            "geofence_lng": forms.NumberInput(attrs={
                "class": "form-control", "step": "any",
                "placeholder": "e.g. -16.5790",
            }),
            "geofence_radius_m": forms.NumberInput(attrs={
                "class": "form-control", "min": 25, "max": 5000,
            }),
            # Certificate logo positioning — hidden inputs the JS preview
            # writes into. We don't show raw number boxes here because the
            # drag UI does it visually.
            "certificate_logo_x_pct": forms.HiddenInput(),
            "certificate_logo_y_pct": forms.HiddenInput(),
            "certificate_logo_width_pct": forms.HiddenInput(),
            "certificate_template_key": forms.HiddenInput(),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Teach the three datetime fields to accept the HTML5 format.
        for fname in ("starts_at", "ends_at", "registration_closes_at"):
            if fname in self.fields:
                self.fields[fname].input_formats = self.DATETIME_LOCAL_FORMATS
        # Apply the kk-form-control class to all unstyled fields. Mirrors
        # what _BaseSignupForm does in accounts/forms.py.
        for name, field in self.fields.items():
            widget = field.widget
            # Hidden inputs and file inputs get left alone — bootstrap's
            # form-control class breaks file pickers visually.
            if isinstance(widget, forms.HiddenInput):
                continue
            existing = widget.attrs.get("class", "")
            if "form-control" not in existing and "form-check-input" not in existing:
                if isinstance(widget, (forms.CheckboxInput,)):
                    widget.attrs["class"] = f"{existing} form-check-input".strip()
                elif isinstance(widget, forms.ClearableFileInput):
                    widget.attrs["class"] = f"{existing} form-control".strip()
                else:
                    widget.attrs["class"] = f"{existing} form-control".strip()

    def clean(self):
        cleaned = super().clean()
        starts = cleaned.get("starts_at")
        ends = cleaned.get("ends_at")
        if starts and ends and ends <= starts:
            raise ValidationError("End time must be after start time.")
        deadline = cleaned.get("registration_closes_at")
        if deadline and starts and deadline > starts:
            # We allow registration to close strictly at-or-before start.
            # Same-time is fine — it means 'until event begins'.
            self.add_error("registration_closes_at",
                           "Registration must close no later than the event start.")
        if cleaned.get("is_online") and not cleaned.get("online_url"):
            self.add_error("online_url", "Required for online events.")

        # Geofence sanity — if they ticked the box, demand coords.
        if cleaned.get("require_geofence"):
            if cleaned.get("geofence_lat") is None or cleaned.get("geofence_lng") is None:
                self.add_error(
                    "require_geofence",
                    "Drop a pin on the venue map (or paste lat/lng) to enable geofencing.",
                )
            radius = cleaned.get("geofence_radius_m")
            if radius and radius < 25:
                self.add_error(
                    "geofence_radius_m",
                    "Radius must be at least 25 m — phone GPS routinely drifts that much.",
                )

        return cleaned


class EventFieldForm(forms.ModelForm):
    """Edit one field on the form-builder side panel."""

    class Meta:
        model = EventField
        fields = ("label", "field_type", "required", "help_text",
                  "placeholder", "options")
        widgets = {
            "label":       forms.TextInput(attrs={"class": "form-control"}),
            "field_type":  forms.Select(attrs={"class": "form-select"}),
            "help_text":   forms.TextInput(attrs={"class": "form-control"}),
            "placeholder": forms.TextInput(attrs={"class": "form-control"}),
            "options":     forms.Textarea(attrs={
                "class": "form-control", "rows": 4,
                "placeholder": "One option per line",
            }),
            "required":    forms.CheckboxInput(attrs={"class": "form-check-input"}),
        }


class AgendaItemForm(forms.ModelForm):
    """One agenda row. Used inline by the agenda editor JS."""

    class Meta:
        model = AgendaItem
        fields = (
            "start_time", "end_time", "title", "description",
            "speaker", "track", "accent_colour", "status",
        )
        widgets = {
            "start_time":   forms.TimeInput(attrs={"type": "time", "class": "form-control"}),
            "end_time":     forms.TimeInput(attrs={"type": "time", "class": "form-control"}),
            "title":        forms.TextInput(attrs={"class": "form-control"}),
            "description":  forms.Textarea(attrs={"class": "form-control", "rows": 2}),
            "speaker":      forms.TextInput(attrs={"class": "form-control"}),
            "track":        forms.TextInput(attrs={"class": "form-control"}),
            "accent_colour": forms.TextInput(attrs={"class": "form-control",
                                                    "placeholder": "#7c3aed"}),
            "status":       forms.Select(attrs={"class": "form-select"}),
        }


# ───────────────────────── Attendee-side ─────────────────────────

class DynamicRegistrationForm(forms.Form):
    """
    Form built at instantiation time from the event's EventField rows.

    Field names are 'field_{pk}' so the view can map answers back to
    EventField rows without touching label text. The two preset keys
    we *do* recognize specially are 'email' and 'phone' — those get
    promoted to top-level Registration columns so the QR-scan lookup
    can find a person by either.
    """

    def __init__(self, event, *args, **kwargs):
        self.event = event
        super().__init__(*args, **kwargs)

        for f in event.fields.all().order_by("order", "id"):
            self.fields[f.html_input_name()] = self._build_field(f)

    @staticmethod
    def _build_field(f):
        common = dict(
            label=f.label,
            required=f.required,
            help_text=f.help_text or "",
        )
        widget_attrs = {"class": "form-control form-control-lg"}
        if f.placeholder:
            widget_attrs["placeholder"] = f.placeholder

        if f.field_type == EventField.TYPE_TEXTAREA:
            return forms.CharField(
                **common,
                widget=forms.Textarea(attrs={**widget_attrs, "rows": 3}),
            )
        if f.field_type == EventField.TYPE_EMAIL:
            return forms.EmailField(**common, widget=forms.EmailInput(attrs=widget_attrs))
        if f.field_type == EventField.TYPE_PHONE:
            # No strict format check — global event audience.
            return forms.CharField(
                **common,
                max_length=40,
                widget=forms.TextInput(attrs={**widget_attrs, "inputmode": "tel"}),
            )
        if f.field_type == EventField.TYPE_NUMBER:
            return forms.IntegerField(
                **common,
                widget=forms.NumberInput(attrs=widget_attrs),
            )
        if f.field_type == EventField.TYPE_DATE:
            return forms.DateField(
                **common,
                widget=forms.DateInput(attrs={**widget_attrs, "type": "date"}),
            )
        if f.field_type == EventField.TYPE_SELECT:
            return forms.ChoiceField(
                **common,
                choices=[("", "Choose…")] + [(o, o) for o in f.options_list()],
                widget=forms.Select(attrs={**widget_attrs, "class": "form-select form-select-lg"}),
            )
        if f.field_type == EventField.TYPE_MULTI:
            return forms.MultipleChoiceField(
                **common,
                choices=[(o, o) for o in f.options_list()],
                widget=forms.CheckboxSelectMultiple(attrs={"class": "form-check-input"}),
            )
        if f.field_type == EventField.TYPE_CHECKBOX:
            # 'required' on a checkbox means *must be ticked* — same UX as
            # accepting T&Cs. Drop the form-control class for this one.
            attrs = {"class": "form-check-input"}
            return forms.BooleanField(
                **common,
                widget=forms.CheckboxInput(attrs=attrs),
            )
        # Default: short text
        return forms.CharField(
            **common, max_length=240,
            widget=forms.TextInput(attrs=widget_attrs),
        )

    # ── Convenience for the view ───────────────────────────────────

    def extract_identity(self):
        """
        Pull (full_name, email, phone) out of the cleaned data based on
        preset_key markers so the view can populate Registration columns.
        Returns ('', '', '') if none of the presets are present.
        """
        name = email = phone = ""
        for f in self.event.fields.all():
            v = self.cleaned_data.get(f.html_input_name())
            if v is None or v == "":
                continue
            if f.preset_key == "full_name":
                name = str(v)[:160]
            elif f.preset_key == "email":
                email = str(v).strip().lower()
            elif f.preset_key == "phone":
                phone = str(v).strip()
        return name, email, phone


class QuickCheckInForm(forms.Form):
    """
    The form shown when someone scans the event-level QR at the door.
    They type their email or phone; we look up an accepted registration
    and flip them to checked_in.
    """

    identifier = forms.CharField(
        label="Email or phone",
        max_length=120,
        widget=forms.TextInput(attrs={
            "class": "form-control form-control-lg",
            "autocomplete": "email",
            "placeholder": "you@example.com or +220 ...",
            "autofocus": True,
        }),
    )

    def __init__(self, event, *args, **kwargs):
        self.event = event
        super().__init__(*args, **kwargs)

    def clean_identifier(self):
        raw = (self.cleaned_data.get("identifier") or "").strip()
        if not raw:
            raise ValidationError("Enter the email or phone you registered with.")
        return raw.lower() if "@" in raw else raw


class AnnouncementForm(forms.Form):
    """Compose an organizer announcement."""

    CHANNEL_CHOICES = [
        ("both",  "Email + in-app"),
        ("email", "Email only"),
        ("push",  "In-app only"),
    ]
    TARGET_CHOICES = [
        ("all",        "Everyone (accepted + checked-in)"),
        ("accepted",   "Accepted only"),
        ("checked_in", "Checked-in only"),
        ("pending",    "Pending approvals"),
    ]

    subject = forms.CharField(
        max_length=200, required=False,
        widget=forms.TextInput(attrs={
            "class": "form-control", "placeholder": "Optional subject",
        }),
    )
    body = forms.CharField(
        widget=forms.Textarea(attrs={"class": "form-control", "rows": 4,
                                     "placeholder": "Your message — agenda update, room change, "
                                                    "'we're starting in 5'…"}),
    )
    channel = forms.ChoiceField(
        choices=CHANNEL_CHOICES, initial="both",
        widget=forms.Select(attrs={"class": "form-select"}),
    )
    audience = forms.ChoiceField(
        choices=TARGET_CHOICES, initial="all",
        widget=forms.Select(attrs={"class": "form-select"}),
    )