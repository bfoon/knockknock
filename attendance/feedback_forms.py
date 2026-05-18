"""
Forms for the feedback feature.

`FeedbackQuestionForm` is used by the organizer's question editor. The
`choices` field is rendered as a textarea (one option per line) so the
JSON storage is invisible to the user.

`build_public_feedback_form` constructs a dynamic Django form whose
fields are derived from the survey's questions. It's analogous to
`DynamicRegistrationForm` in the main forms.py — built per request,
not declared up-front, so each survey gets exactly the fields its
organizer defined.
"""

from django import forms

from .feedback_models import FeedbackQuestion


# ─────────────────────────── Organizer-side ───────────────────────────

class FeedbackQuestionForm(forms.ModelForm):
    """
    Admin form for adding/editing one question on a survey.

    `choices_text` is the user-facing input — one option per line.
    We pack/unpack it from the model's JSON `choices` field manually so
    the textarea stays simple.
    """

    choices_text = forms.CharField(
        required=False,
        widget=forms.Textarea(attrs={
            "class": "form-control",
            "rows": 4,
            "placeholder": "One option per line",
        }),
        label="Options",
        help_text="Only used for Multiple choice. One option per line.",
    )

    class Meta:
        model = FeedbackQuestion
        fields = ("text", "question_type", "required")
        widgets = {
            "text": forms.TextInput(attrs={
                "class": "form-control",
                "placeholder": "e.g. How would you rate the workshop?",
                "maxlength": "400",
            }),
            "question_type": forms.Select(attrs={
                "class": "form-select",
                "data-feedback-type": "1",
            }),
            "required": forms.CheckboxInput(attrs={
                "class": "form-check-input",
            }),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Prefill the textarea from the JSON field when editing.
        if self.instance and self.instance.pk:
            existing = self.instance.cleaned_choices()
            self.fields["choices_text"].initial = "\n".join(existing)

    def clean(self):
        cleaned = super().clean()
        qtype = cleaned.get("question_type")
        raw = (cleaned.get("choices_text") or "").strip()
        options = [line.strip() for line in raw.splitlines() if line.strip()]

        if qtype == FeedbackQuestion.TYPE_MULTIPLE_CHOICE:
            if len(options) < 2:
                self.add_error(
                    "choices_text",
                    "Multiple-choice questions need at least two options.",
                )
        else:
            # Discard whatever they typed for non-mcq types — keeps storage clean.
            options = []

        # Separators are visual-only; the `required` flag is meaningless
        # for them and would just confuse the results page. Force it off.
        if qtype == FeedbackQuestion.TYPE_SEPARATOR:
            cleaned["required"] = False

        cleaned["_parsed_choices"] = options
        return cleaned

    def save(self, commit=True):
        instance = super().save(commit=False)
        instance.choices = self.cleaned_data.get("_parsed_choices", [])
        if commit:
            instance.save()
        return instance


# ─────────────────────────── Public-side ───────────────────────────

def _field_name_for(question):
    """Stable field name for a question in the dynamic form."""
    return f"q_{question.pk}"


def build_public_feedback_form(survey, data=None):
    """
    Build a dynamic form for `survey`. One Django field per question,
    typed according to the question's question_type.

    Returns the form instance (bound to `data` if provided). Use
    `parse_public_feedback_answers(form, survey)` after `is_valid()`
    to get a list of (question, value_dict) pairs you can write into
    FeedbackAnswer rows.
    """
    questions = list(survey.questions.all().order_by("order", "id"))

    field_defs = {}
    for q in questions:
        # Separators don't render as form fields — the template loops
        # through `form._questions` separately and emits a section
        # header for them. Skip here so no Django field is created.
        if q.is_separator():
            continue

        name = _field_name_for(q)
        required = bool(q.required)
        label = q.text

        if q.question_type == FeedbackQuestion.TYPE_OPEN_TEXT:
            field = forms.CharField(
                label=label,
                required=required,
                max_length=4000,
                widget=forms.Textarea(attrs={
                    "class": "form-control",
                    "rows": 3,
                    "placeholder": "Your answer…",
                }),
            )
        elif q.question_type == FeedbackQuestion.TYPE_RATE_1_5:
            # Rendered as 5 radio buttons in the template — the value
            # is "1".."5". We accept ChoiceField for tight validation.
            field = forms.ChoiceField(
                label=label,
                required=required,
                choices=[(str(i), str(i)) for i in range(1, 6)],
                widget=forms.RadioSelect(attrs={
                    "class": "kk-feedback-rating-input",
                }),
            )
        elif q.question_type == FeedbackQuestion.TYPE_MULTIPLE_CHOICE:
            opts = q.cleaned_choices()
            field = forms.ChoiceField(
                label=label,
                required=required,
                choices=[(opt, opt) for opt in opts],
                widget=forms.RadioSelect(attrs={
                    "class": "form-check-input",
                }),
            )
        elif q.question_type == FeedbackQuestion.TYPE_YES_NO:
            field = forms.ChoiceField(
                label=label,
                required=required,
                choices=[("yes", "Yes"), ("no", "No")],
                widget=forms.RadioSelect(attrs={
                    "class": "form-check-input",
                }),
            )
        else:
            # Unknown type — skip silently rather than 500 the public page.
            continue

        field_defs[name] = field

    PublicFeedbackForm = type("PublicFeedbackForm", (forms.Form,), field_defs)
    form = PublicFeedbackForm(data) if data is not None else PublicFeedbackForm()
    # Attach the questions list so the template can iterate alongside the
    # bound form without re-querying.
    form._questions = questions
    form._field_name_for = _field_name_for
    return form


def parse_public_feedback_answers(form, survey):
    """
    Turn a cleaned public form into a list of (question, dict) tuples
    suitable for FeedbackAnswer.objects.create(**dict, response=...,
    question=question). Skips questions whose answer is blank.
    """
    out = []
    cleaned = form.cleaned_data
    for q in survey.questions.all().order_by("order", "id"):
        if q.is_separator():
            continue
        name = _field_name_for(q)
        raw = cleaned.get(name, None)
        if raw in (None, "", []):
            continue

        if q.question_type == FeedbackQuestion.TYPE_OPEN_TEXT:
            out.append((q, {"text_answer": str(raw).strip()}))
        elif q.question_type == FeedbackQuestion.TYPE_RATE_1_5:
            try:
                rating = int(raw)
            except (TypeError, ValueError):
                continue
            if 1 <= rating <= 5:
                out.append((q, {"rating": rating}))
        elif q.question_type == FeedbackQuestion.TYPE_MULTIPLE_CHOICE:
            out.append((q, {"choice_answer": str(raw)}))
        elif q.question_type == FeedbackQuestion.TYPE_YES_NO:
            out.append((q, {"bool_answer": (str(raw).lower() == "yes")}))
    return out