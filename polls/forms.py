from django import forms
from django.contrib.auth import get_user_model
from .models import Questionnaire, Question, Choice, QuestionnaireCollaborator


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
                "class": "form-control",
                "rows": 2,
                "placeholder": "Optional description",
            }),
            "logo": forms.FileInput(attrs={
                "class": "form-control",
                "accept": "image/*",
            }),
            "mode": forms.Select(attrs={"class": "form-select"}),
        }

class QuestionForm(forms.ModelForm):
    class Meta:
        model = Question
        fields = ("text", "type", "chart_type", "image", "font_family", "font_size", "font_bold")
        widgets = {
            "text": forms.TextInput(attrs={"class": "form-control form-control-lg", "placeholder": "Type your question…"}),
            "type": forms.Select(attrs={"class": "form-select", "data-question-type": True}),
            "chart_type": forms.HiddenInput(),
            "image": forms.FileInput(attrs={"class": "form-control"}),
            "font_family": forms.Select(attrs={"class": "form-select"}),
            "font_size": forms.NumberInput(attrs={"class": "form-control", "min": 24, "max": 96, "step": 2}),
            "font_bold": forms.CheckboxInput(attrs={"class": "form-check-input"}),
        }


ChoiceFormSet = forms.inlineformset_factory(
    Question, Choice,
    fields=("text",),
    extra=2, can_delete=True, max_num=10,
    widgets={"text": forms.TextInput(attrs={"class": "form-control", "placeholder": "Option…"})}
)


class CollaboratorInviteForm(forms.Form):
    """Invite by username OR email — try both."""
    identifier = forms.CharField(
        max_length=150,
        widget=forms.TextInput(attrs={"class": "form-control", "placeholder": "Username or email"}),
        label="Username or email",
    )
    role = forms.ChoiceField(
        choices=QuestionnaireCollaborator.ROLE_CHOICES,
        initial="edit",
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