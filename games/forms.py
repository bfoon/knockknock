from django import forms
from .models import Quiz, GameQuestion, GameChoice


class QuizForm(forms.ModelForm):
    class Meta:
        model = Quiz
        fields = (
            "title", "description", "template_id", "logo",
            "scoring", "mode", "use_rooms", "room_capacity",
            "chart_background",
        )
        widgets = {
            "title": forms.TextInput(attrs={"class": "form-control form-control-lg"}),
            "description": forms.Textarea(attrs={"class": "form-control", "rows": 2}),
            "template_id": forms.HiddenInput(),
            "logo": forms.FileInput(attrs={"class": "form-control"}),
            "scoring": forms.Select(attrs={"class": "form-select"}),
            "mode": forms.Select(attrs={"class": "form-select"}),
            "use_rooms": forms.CheckboxInput(attrs={"class": "form-check-input"}),
            "room_capacity": forms.NumberInput(attrs={"class": "form-control", "min": 2, "max": 100}),
            "chart_background": forms.Select(attrs={"class": "form-select"}),
        }


class GameQuestionForm(forms.ModelForm):
    class Meta:
        model = GameQuestion
        fields = ("text", "image", "time_limit", "points",
                  "font_family", "font_size", "font_bold")
        widgets = {
            "text": forms.TextInput(attrs={"class": "form-control form-control-lg", "id": "id_question_text"}),
            "image": forms.FileInput(attrs={"class": "form-control"}),
            "time_limit": forms.NumberInput(attrs={"class": "form-control", "min": 5, "max": 180}),
            "points": forms.NumberInput(attrs={"class": "form-control", "min": 100, "max": 10000, "step": 100}),
            "font_family": forms.Select(attrs={"class": "form-select", "id": "id_font_family"}),
            "font_size": forms.NumberInput(attrs={"class": "form-control", "min": 16, "max": 96, "step": 2, "id": "id_font_size"}),
            "font_bold": forms.CheckboxInput(attrs={"class": "form-check-input", "id": "id_font_bold"}),
        }


GameChoiceFormSet = forms.inlineformset_factory(
    GameQuestion, GameChoice,
    fields=("text", "is_correct"),
    extra=4, max_num=6, can_delete=True,
    widgets={
        "text": forms.TextInput(attrs={"class": "form-control", "placeholder": "Answer option…"}),
        "is_correct": forms.CheckboxInput(attrs={"class": "form-check-input"}),
    },
)