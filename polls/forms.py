from django import forms
from .models import Questionnaire, Question, Choice


class QuestionnaireForm(forms.ModelForm):
    class Meta:
        model = Questionnaire
        fields = ("title", "description", "template_id", "logo", "mode")
        widgets = {
            "title": forms.TextInput(attrs={"class": "form-control form-control-lg", "placeholder": "Untitled questionnaire"}),
            "description": forms.Textarea(attrs={"class": "form-control", "rows": 2, "placeholder": "Optional description"}),
            "template_id": forms.HiddenInput(),
            "logo": forms.FileInput(attrs={"class": "form-control"}),
            "mode": forms.Select(attrs={"class": "form-select"}),
        }


class QuestionForm(forms.ModelForm):
    class Meta:
        model = Question
        fields = ("text", "type", "chart_type", "image")
        widgets = {
            "text": forms.TextInput(attrs={"class": "form-control form-control-lg", "placeholder": "Type your question…"}),
            "type": forms.Select(attrs={"class": "form-select", "data-question-type": True}),
            "chart_type": forms.HiddenInput(),
            "image": forms.FileInput(attrs={"class": "form-control"}),
        }


ChoiceFormSet = forms.inlineformset_factory(
    Question, Choice,
    fields=("text",),
    extra=2, can_delete=True, max_num=10,
    widgets={"text": forms.TextInput(attrs={"class": "form-control", "placeholder": "Option…"})}
)
