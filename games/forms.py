from django import forms
from django.utils.text import slugify
from .models import Quiz, GameQuestion, GameChoice, GameRoom


class QuizForm(forms.ModelForm):
    class Meta:
        model = Quiz
        fields = (
            "title", "description", "template_id", "logo",
            "scoring", "mode", "use_rooms", "room_capacity", "chart_background",
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
        fields = (
            "question_type", "text", "image", "time_limit", "points",
            "font_family", "font_size", "font_bold", "text_italic", "text_underline",
            "text_align", "text_color", "background_color", "background_gradient_to", "answer_shape",
        )
        widgets = {
            "question_type": forms.Select(attrs={"class": "form-select", "id": "id_question_type"}),
            "text": forms.TextInput(attrs={"class": "form-control form-control-lg", "id": "id_question_text"}),
            "image": forms.FileInput(attrs={"class": "form-control"}),
            "time_limit": forms.NumberInput(attrs={"class": "form-control", "min": 5, "max": 180}),
            "points": forms.NumberInput(attrs={"class": "form-control", "min": 100, "max": 10000, "step": 100}),
            "font_family": forms.Select(attrs={"class": "form-select", "id": "id_font_family"}),
            "font_size": forms.NumberInput(attrs={"class": "form-control", "min": 16, "max": 96, "step": 2, "id": "id_font_size"}),
            "font_bold": forms.CheckboxInput(attrs={"class": "form-check-input", "id": "id_font_bold"}),
            "text_italic": forms.CheckboxInput(attrs={"id": "id_text_italic", "style": "display:none;"}),
            "text_underline": forms.CheckboxInput(attrs={"id": "id_text_underline", "style": "display:none;"}),
            "text_align": forms.HiddenInput(attrs={"id": "id_text_align"}),
            "text_color": forms.HiddenInput(attrs={"id": "id_text_color"}),
            "background_color": forms.HiddenInput(attrs={"id": "id_background_color"}),
            "background_gradient_to": forms.HiddenInput(attrs={"id": "id_background_gradient_to"}),
            "answer_shape": forms.HiddenInput(attrs={"id": "id_answer_shape"}),
        }


class GameChoiceForm(forms.ModelForm):
    class Meta:
        model = GameChoice
        fields = ("text", "image", "is_correct", "correct_position", "order")
        widgets = {
            "text": forms.TextInput(attrs={"class": "form-control", "placeholder": "Answer text / picture caption / puzzle label…"}),
            "image": forms.FileInput(attrs={"class": "form-control form-control-sm kk-choice-image-input"}),
            "is_correct": forms.CheckboxInput(attrs={"class": "form-check-input kk-choice-correct-input"}),
            "correct_position": forms.NumberInput(attrs={"class": "form-control form-control-sm kk-choice-position-input", "min": 0}),
            "order": forms.NumberInput(attrs={"class": "form-control form-control-sm", "min": 0}),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["text"].required = False
        self.fields["image"].required = False
        self.fields["is_correct"].required = False
        self.fields["correct_position"].required = False
        self.fields["order"].required = False

    def clean(self):
        cleaned = super().clean()
        if cleaned.get("DELETE"):
            return cleaned
        if cleaned.get("correct_position") is None:
            cleaned["correct_position"] = 0
        if cleaned.get("order") is None:
            cleaned["order"] = 0
        return cleaned


GameChoiceFormSet = forms.inlineformset_factory(
    GameQuestion, GameChoice, form=GameChoiceForm, extra=4, max_num=8, can_delete=True,
)


class GameRoomForm(forms.ModelForm):
    """One row in the rooms editor."""

    class Meta:
        model = GameRoom
        fields = ("name", "avatar_id", "slug", "order")
        widgets = {
            "name": forms.TextInput(attrs={"class": "form-control", "placeholder": "Room name (e.g. Dragons, Stage A)", "maxlength": "60"}),
            "avatar_id": forms.HiddenInput(attrs={"class": "kk-room-avatar-input"}),
            "slug": forms.HiddenInput(),
            "order": forms.HiddenInput(attrs={"class": "kk-room-order-input"}),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["slug"].required = False
        self.fields["name"].required = True
        self.fields["avatar_id"].required = False
        self.fields["order"].required = False

    def clean(self):
        cleaned = super().clean()
        if cleaned.get("DELETE"):
            return cleaned
        name = (cleaned.get("name") or "").strip()
        slug = (cleaned.get("slug") or "").strip()
        if name and not slug:
            cleaned["slug"] = slugify(name) or "room"
        elif slug and not name:
            self.add_error("name", "Name is required.")
        if not (cleaned.get("avatar_id") or "").strip():
            cleaned["avatar_id"] = "dragon"
        if cleaned.get("order") is None:
            cleaned["order"] = 0
        return cleaned


GameRoomFormSet = forms.inlineformset_factory(Quiz, GameRoom, form=GameRoomForm, extra=0, can_delete=True)
