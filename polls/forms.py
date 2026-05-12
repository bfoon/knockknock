from django import forms
from django.contrib.auth import get_user_model
from django.forms.models import BaseInlineFormSet

from .charts import (
    chart_choice_field_choices,
    curated_charts_for,
    is_chart_curated_for,
)
from .models import (
    Choice,
    MatrixRow,
    Question,
    Questionnaire,
    QuestionnaireCollaborator,
)
from .question_types import QUESTION_TYPE_REGISTRY


class QuestionnaireForm(forms.ModelForm):
    class Meta:
        model = Questionnaire
        fields = ("title", "description", "logo", "mode")
        widgets = {
            "title": forms.TextInput(attrs={
                "class": "form-control form-control-lg",
                "placeholder": "Untitled questionnaire",
            }),
            "description": forms.Textarea(attrs={
                "class": "form-control", "rows": 2,
                "placeholder": "Optional description",
            }),
            "logo": forms.FileInput(attrs={"class": "form-control", "accept": "image/*"}),
            "mode": forms.Select(attrs={"class": "form-select"}),
        }


class QuestionForm(forms.ModelForm):
    """
    Main question editor form. Handles all 20 types; the editor template
    decides which extra partial (qtype_<id>.html) to render alongside.
    """

    class Meta:
        model = Question
        fields = (
            "text", "type", "chart_type", "image",
            # Typography
            "font_family", "font_size", "font_bold",
            # Flexibility
            "time_limit_seconds", "is_required", "is_anonymous",
            "min_selections", "max_selections", "template_id_override",
            # Title-slide fields (ignored unless type == "title")
            "subtitle", "title_layout", "title_image", "title_author",
        )
        widgets = {
            "text": forms.TextInput(attrs={
                "class": "form-control form-control-lg",
                "placeholder": "Type your question…",
            }),
            "type": forms.Select(attrs={
                "class": "form-select",
                "data-question-type": "true",
                "id": "id_question_type",
            }),
            "chart_type": forms.Select(attrs={
                "class": "form-select",
                "id": "id_chart_type",
            }),
            "image": forms.FileInput(attrs={"class": "form-control", "accept": "image/*"}),
            "font_family": forms.Select(attrs={"class": "form-select"}),
            "font_size": forms.NumberInput(attrs={
                "class": "form-control", "min": 24, "max": 96, "step": 2,
            }),
            "font_bold": forms.CheckboxInput(attrs={"class": "form-check-input"}),
            "time_limit_seconds": forms.NumberInput(attrs={
                "class": "form-control", "min": 5, "max": 600,
                "placeholder": "No limit",
            }),
            "is_required": forms.CheckboxInput(attrs={"class": "form-check-input"}),
            "is_anonymous": forms.CheckboxInput(attrs={"class": "form-check-input"}),
            "min_selections": forms.NumberInput(attrs={
                "class": "form-control", "min": 1, "placeholder": "1",
            }),
            "max_selections": forms.NumberInput(attrs={
                "class": "form-control", "min": 1, "placeholder": "Unlimited",
            }),
            "template_id_override": forms.TextInput(attrs={
                "class": "form-control", "placeholder": "Inherit from questionnaire",
            }),
            # Title-slide widgets
            "subtitle": forms.TextInput(attrs={
                "class": "form-control",
                "placeholder": "Subtitle, kicker, or quote body…",
            }),
            "title_layout": forms.Select(attrs={"class": "form-select"}),
            "title_image": forms.FileInput(attrs={"class": "form-control", "accept": "image/*"}),
            "title_author": forms.TextInput(attrs={
                "class": "form-control",
                "placeholder": "— Author (for quote layout)",
            }),
        }

    def __init__(self, *args, show_all_charts=False, **kwargs):
        super().__init__(*args, **kwargs)
        # Make `type` a proper choice field driven by the registry
        self.fields["type"].choices = [
            (k, f"{v['icon']} {v['label']}") for k, v in QUESTION_TYPE_REGISTRY.items()
        ]
        # chart_type is rendered as a select; the template offers two views
        # (curated vs all) so we just set the available options to ALL here
        # and rely on data attributes for the curated subset filtering.
        self.fields["chart_type"].choices = chart_choice_field_choices()

    def clean(self):
        cleaned = super().clean()
        min_s = cleaned.get("min_selections")
        max_s = cleaned.get("max_selections")
        if min_s and max_s and min_s > max_s:
            raise forms.ValidationError(
                "Min selections can't be greater than max selections."
            )
        # Soft-validate chart against question type (warn rather than block)
        # — strict validation would frustrate users who want overrides.
        qtype = cleaned.get("type")
        chart = cleaned.get("chart_type")
        if qtype and chart and not is_chart_curated_for(qtype, chart):
            # Just attach a hint on the form for the template; don't error.
            self._chart_override_warning = (
                f"You're using a non-default chart for {qtype}. That's fine — "
                "just be sure it renders the way you expect."
            )
        return cleaned


# ── Choice form ─────────────────────────────────
# Custom ModelForm so we can make `weight` optional at the form layer.
# The model has default=0, but Django's auto-generated FloatField treats it
# as required when blank=False (the model default). We override that here so
# the formset accepts an empty weight value and falls back to 0.

class ChoiceForm(forms.ModelForm):
    class Meta:
        model = Choice
        fields = ("text", "image", "weight")
        widgets = {
            "text": forms.TextInput(attrs={
                "class": "form-control", "placeholder": "Option…",
            }),
            "image": forms.FileInput(attrs={
                "class": "form-control", "accept": "image/*",
            }),
            "weight": forms.NumberInput(attrs={
                "class": "form-control", "min": 0, "step": 1,
                "placeholder": "0",
            }),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["weight"].required = False

    def clean_weight(self):
        w = self.cleaned_data.get("weight")
        return 0 if w in (None, "") else w

    def has_changed(self):
        """
        Treat a row as "blank" if the user didn't enter any text and didn't
        upload an image. Without this override, the hidden `weight=0` posted
        by the template makes Django think the row has data, which bypasses
        `empty_permitted` and forces validation on `text`.
        """
        text = (self.data.get(self.add_prefix("text")) or "").strip()
        image = self.files.get(self.add_prefix("image"))
        if not text and not image:
            return False
        return super().has_changed()


# ── Base inline formset that treats fully-blank EXTRA rows as "skip me" ──
# Django renders `extra` blank forms at the bottom. Without this, when the
# user clicks Save those blanks fail validation with "text: This field is
# required." We mark each extra (non-initial) form as `empty_permitted` so
# Django silently skips it if no field has data. Initial (existing) forms
# still validate normally.

class BaseChoiceFormSet(BaseInlineFormSet):
    def _construct_form(self, i, **kwargs):
        form = super()._construct_form(i, **kwargs)
        if i >= self.initial_form_count():
            form.empty_permitted = True
        return form


# ── Choice formset (used by mcq, image_choice, ranking, points_allocation,
#                       likert (auto-populated), yes_no (auto-populated), reaction) ──
ChoiceFormSet = forms.inlineformset_factory(
    Question, Choice,
    form=ChoiceForm,
    formset=BaseChoiceFormSet,
    extra=2, can_delete=True, max_num=20,
)


# ── MatrixRow formset (matrix type only) ──
# Same blank-extras treatment so empty matrix rows don't fail validation.

class BaseMatrixRowFormSet(BaseInlineFormSet):
    def _construct_form(self, i, **kwargs):
        form = super()._construct_form(i, **kwargs)
        if i >= self.initial_form_count():
            form.empty_permitted = True
        return form


MatrixRowFormSet = forms.inlineformset_factory(
    Question, MatrixRow,
    fields=("text",),
    formset=BaseMatrixRowFormSet,
    extra=2, can_delete=True, max_num=20,
    widgets={
        "text": forms.TextInput(attrs={
            "class": "form-control",
            "placeholder": "Row label (e.g. 'Speed', 'Reliability')",
        }),
    },
)


# ── Type-specific config forms ──────────────────
# Each renders the editor UI for fields stored in Question.config (JSON).
# The view validates the matching one based on question.type and saves to .config.

class ScaleConfigForm(forms.Form):
    scale_min = forms.IntegerField(
        initial=1,
        min_value=1,
        max_value=10,
        label="Minimum value",
        help_text="Usually 1. Keep this lower than the maximum value.",
        widget=forms.NumberInput(attrs={"class": "form-control", "min": 1, "max": 10}),
    )
    scale_max = forms.IntegerField(
        initial=10,
        min_value=2,
        max_value=10,
        label="Maximum value",
        help_text="Use 5 for a 1–5 scale, or leave 10 for the default 1–10 scale.",
        widget=forms.NumberInput(attrs={"class": "form-control", "min": 2, "max": 10}),
    )

    def clean(self):
        c = super().clean()
        min_v = c.get("scale_min")
        max_v = c.get("scale_max")
        if min_v is not None and max_v is not None and min_v >= max_v:
            raise forms.ValidationError("Minimum value must be less than maximum value.")
        return c


class SliderConfigForm(forms.Form):
    min = forms.IntegerField(initial=0, widget=forms.NumberInput(attrs={"class": "form-control"}))
    max = forms.IntegerField(initial=100, widget=forms.NumberInput(attrs={"class": "form-control"}))
    step = forms.IntegerField(initial=1, min_value=1, widget=forms.NumberInput(attrs={"class": "form-control"}))
    unit = forms.CharField(required=False, max_length=16,
                           widget=forms.TextInput(attrs={"class": "form-control", "placeholder": "%, $, pts…"}))

    def clean(self):
        c = super().clean()
        if c.get("min") is not None and c.get("max") is not None and c["min"] >= c["max"]:
            raise forms.ValidationError("Min must be less than max.")
        return c


class RatingConfigForm(forms.Form):
    max_stars = forms.IntegerField(
        initial=5, min_value=3, max_value=10,
        widget=forms.NumberInput(attrs={"class": "form-control"}),
    )


class NumericConfigForm(forms.Form):
    min = forms.FloatField(required=False, widget=forms.NumberInput(attrs={"class": "form-control", "placeholder": "No min"}))
    max = forms.FloatField(required=False, widget=forms.NumberInput(attrs={"class": "form-control", "placeholder": "No max"}))
    decimals = forms.IntegerField(
        initial=0, min_value=0, max_value=6,
        widget=forms.NumberInput(attrs={"class": "form-control"}),
    )


class FileConfigForm(forms.Form):
    max_size_mb = forms.IntegerField(
        initial=10, min_value=1, max_value=100,
        widget=forms.NumberInput(attrs={"class": "form-control"}),
    )
    accept = forms.CharField(
        initial="image/*", max_length=80,
        widget=forms.TextInput(attrs={"class": "form-control",
                                      "placeholder": "image/*, application/pdf, …"}),
    )


class PinMapConfigForm(forms.Form):
    center_lat = forms.FloatField(initial=0, widget=forms.NumberInput(attrs={"class": "form-control", "step": "any"}))
    center_lng = forms.FloatField(initial=0, widget=forms.NumberInput(attrs={"class": "form-control", "step": "any"}))
    zoom = forms.IntegerField(initial=2, min_value=1, max_value=18, widget=forms.NumberInput(attrs={"class": "form-control"}))


class TwoByTwoConfigForm(forms.Form):
    x_left = forms.CharField(initial="Hard", max_length=40, widget=forms.TextInput(attrs={"class": "form-control"}))
    x_right = forms.CharField(initial="Easy", max_length=40, widget=forms.TextInput(attrs={"class": "form-control"}))
    y_bottom = forms.CharField(initial="Low impact", max_length=40, widget=forms.TextInput(attrs={"class": "form-control"}))
    y_top = forms.CharField(initial="High impact", max_length=40, widget=forms.TextInput(attrs={"class": "form-control"}))


class MatrixConfigForm(forms.Form):
    scale_min = forms.IntegerField(initial=1, min_value=1, max_value=10,
                                   widget=forms.NumberInput(attrs={"class": "form-control"}))
    scale_max = forms.IntegerField(initial=5, min_value=2, max_value=10,
                                   widget=forms.NumberInput(attrs={"class": "form-control"}))
    scale_labels = forms.CharField(
        required=False,
        widget=forms.TextInput(attrs={"class": "form-control",
                                      "placeholder": "e.g. Bad,Poor,OK,Good,Great"}),
        help_text="Comma-separated labels — one per step. Optional.",
    )


class PointsConfigForm(forms.Form):
    total = forms.IntegerField(
        initial=100, min_value=10, max_value=1000,
        widget=forms.NumberInput(attrs={"class": "form-control"}),
    )


class DateConfigForm(forms.Form):
    min = forms.DateField(required=False, widget=forms.DateInput(attrs={"class": "form-control", "type": "date"}))
    max = forms.DateField(required=False, widget=forms.DateInput(attrs={"class": "form-control", "type": "date"}))


# Map question type → config form class. Types without a config form
# can leave Question.config as {} — the view checks for None here.
CONFIG_FORM_BY_TYPE = {
    "scale": ScaleConfigForm,
    "slider": SliderConfigForm,
    "rating": RatingConfigForm,
    "numeric": NumericConfigForm,
    "file_upload": FileConfigForm,
    "pin_map": PinMapConfigForm,
    "two_by_two": TwoByTwoConfigForm,
    "matrix": MatrixConfigForm,
    "points_allocation": PointsConfigForm,
    "date": DateConfigForm,
    "datetime": DateConfigForm,  # reuses (min/max date)
}


# ── Branching rules form ────────────────────────
class SkipRuleForm(forms.Form):
    """
    Single skip rule for the JSON skip_rules list.
    Two conditions supported:
      - if a specific choice is picked  (MCQ/yes_no/likert/image_choice)
      - if numeric value falls in range (scale/rating/nps/slider/numeric)
    """
    if_choice_id = forms.IntegerField(required=False, widget=forms.HiddenInput())
    if_value_min = forms.FloatField(required=False, widget=forms.NumberInput(attrs={
        "class": "form-control form-control-sm", "placeholder": "min",
    }))
    if_value_max = forms.FloatField(required=False, widget=forms.NumberInput(attrs={
        "class": "form-control form-control-sm", "placeholder": "max",
    }))
    jump_to_order = forms.IntegerField(widget=forms.NumberInput(attrs={
        "class": "form-control form-control-sm", "placeholder": "Question #",
    }))


class CollaboratorInviteForm(forms.Form):
    identifier = forms.CharField(
        max_length=150,
        widget=forms.TextInput(attrs={"class": "form-control", "placeholder": "Username or email"}),
        label="Username or email",
    )
    role = forms.ChoiceField(
        choices=QuestionnaireCollaborator.ROLE_CHOICES, initial="edit",
        widget=forms.Select(attrs={"class": "form-select"}),
    )

    def find_user(self):
        ident = self.cleaned_data["identifier"].strip()
        User = get_user_model()
        try:
            return User.objects.get(username__iexact=ident)
        except User.DoesNotExist:
            try:
                return User.objects.get(email__iexact=ident)
            except User.DoesNotExist:
                return None