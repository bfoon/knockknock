import re

from django import forms
from django.utils.text import slugify

from .avatars import normalize_avatar_id
from .models import Quiz, GameQuestion, GameChoice, GameRoom

HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")


def _clean_hex(value, fallback):
    """Colour inputs post `#rrggbb`. Anything else is a client bug or a probe."""
    value = (value or "").strip()
    if HEX_COLOR.match(value):
        return value.lower()
    return fallback


class QuizForm(forms.ModelForm):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # The visual template picker is rendered by a shared partial. In some
        # layouts that picker does not submit `template_id` directly, so keep
        # the field non-required and fall back to the current/default template.
        self.fields["template_id"].required = False
        self.fields["chart_background"].required = False

        # Do NOT require this field. When late answers are off, the browser
        # disables the number input, so it is not included in POST at all.
        # Without this, the whole quiz edit form fails validation and it looks
        # like main/chart backgrounds are not saving.
        self.fields["late_answer_points_pct"].required = False
        self.fields["room_capacity"].required = False

        self.fields["title"].label = "Game title"
        self.fields["room_capacity"].help_text = "Players per room, 2–100."

    def clean_title(self):
        title = (self.cleaned_data.get("title") or "").strip()
        if not title:
            raise forms.ValidationError("Give the game a title so you can find it later.")
        return title

    def clean_template_id(self):
        value = (self.cleaned_data.get("template_id") or "").strip()
        if value:
            return value
        current = getattr(self.instance, "template_id", "") or ""
        return current.strip() or "neon_gaming"

    def clean_chart_background(self):
        value = (self.cleaned_data.get("chart_background") or "").strip()
        if value:
            return value
        current = getattr(self.instance, "chart_background", "") or ""
        return current.strip() or "normal"

    def clean_room_capacity(self):
        value = self.cleaned_data.get("room_capacity")
        if value in (None, ""):
            return getattr(self.instance, "room_capacity", None) or 10
        value = int(value)
        if value < 2:
            raise forms.ValidationError("A room needs space for at least 2 players.")
        if value > 100:
            raise forms.ValidationError("Rooms cap out at 100 players.")
        return value

    def clean_late_answer_points_pct(self):
        # This is optional. If late answers are disabled, always store 0.
        # If late answers are enabled but left blank, also default to 0,
        # meaning late answers can be accepted but receive no points.
        allow_late = bool(self.cleaned_data.get("allow_late_answers"))
        value = self.cleaned_data.get("late_answer_points_pct")

        if not allow_late:
            return 0

        if value in (None, ""):
            return 0

        value = int(value)
        if value < 0 or value > 100:
            raise forms.ValidationError("Enter a value from 0 to 100.")
        return value

    class Meta:
        model = Quiz
        fields = (
            "title", "description", "template_id", "logo",
            "scoring", "mode", "use_rooms", "room_capacity", "chart_background",
            "allow_late_answers", "late_answer_points_pct",
        )
        widgets = {
            "title": forms.TextInput(attrs={"class": "form-control form-control-lg", "placeholder": "Friday quiz"}),
            "description": forms.Textarea(attrs={"class": "form-control", "rows": 2,
                                                 "placeholder": "What is this game about? (optional)"}),
            "template_id": forms.HiddenInput(),
            "logo": forms.FileInput(attrs={"class": "form-control", "accept": "image/*"}),
            "scoring": forms.Select(attrs={"class": "form-select"}),
            "mode": forms.Select(attrs={"class": "form-select"}),
            "use_rooms": forms.CheckboxInput(attrs={"class": "form-check-input"}),
            "room_capacity": forms.NumberInput(attrs={"class": "form-control", "min": 2, "max": 100}),
            "chart_background": forms.Select(attrs={"class": "form-select"}),
            "allow_late_answers": forms.CheckboxInput(attrs={"class": "form-check-input", "id": "id_allow_late_answers"}),
            "late_answer_points_pct": forms.NumberInput(attrs={
                "class": "form-control", "min": 0, "max": 100, "step": 5,
                "id": "id_late_answer_points_pct",
            }),
        }


class GameQuestionForm(forms.ModelForm):
    def clean_text(self):
        text = (self.cleaned_data.get("text") or "").strip()
        if not text:
            raise forms.ValidationError("Players need to see a question here.")
        return text

    def clean_font_size(self):
        value = self.cleaned_data.get("font_size") or 32
        return max(16, min(96, int(value)))

    def clean_text_color(self):
        return _clean_hex(self.cleaned_data.get("text_color"), "#f8fafc")

    def clean_background_color(self):
        return _clean_hex(self.cleaned_data.get("background_color"), "#1e293b")

    def clean_background_gradient_to(self):
        value = (self.cleaned_data.get("background_gradient_to") or "").strip()
        if not value:
            return ""          # gradient toggle off
        return _clean_hex(value, "")

    def clean_text_align(self):
        value = (self.cleaned_data.get("text_align") or "").strip()
        valid = {v for v, _ in GameQuestion.ALIGN_CHOICES}
        return value if value in valid else "center"

    def clean_answer_shape(self):
        value = (self.cleaned_data.get("answer_shape") or "").strip()
        valid = {v for v, _ in GameQuestion.SHAPE_CHOICES}
        return value if value in valid else "rounded"

    class Meta:
        model = GameQuestion
        fields = (
            "question_type", "text", "image", "time_limit", "points",
            "font_family", "font_size", "font_bold", "text_italic", "text_underline",
            "text_align", "text_color", "background_color", "background_gradient_to", "answer_shape",
        )
        widgets = {
            "question_type": forms.Select(attrs={"class": "form-select", "id": "id_question_type"}),
            "text": forms.TextInput(attrs={"class": "form-control form-control-lg", "id": "id_question_text",
                                           "placeholder": "Ask something"}),
            "image": forms.FileInput(attrs={"class": "form-control", "accept": "image/*",
                                            "id": "id_question_image"}),
            "time_limit": forms.NumberInput(attrs={"class": "form-control", "min": 5, "max": 600}),
            "points": forms.NumberInput(attrs={"class": "form-control", "min": 0, "max": 10000, "step": 100}),
            "font_family": forms.Select(attrs={"class": "form-select", "id": "id_font_family"}),
            "font_size": forms.NumberInput(attrs={"class": "form-control g-size-num", "min": 16, "max": 96, "step": 2, "id": "id_font_size"}),
            "font_bold": forms.CheckboxInput(attrs={"class": "form-check-input", "id": "id_font_bold"}),
            "text_italic": forms.CheckboxInput(attrs={"id": "id_text_italic"}),
            "text_underline": forms.CheckboxInput(attrs={"id": "id_text_underline"}),
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
            "text": forms.TextInput(attrs={"class": "form-control kk-choice-text-input",
                                           "placeholder": "Type an answer…"}),
            "image": forms.FileInput(attrs={"class": "form-control form-control-sm kk-choice-image-input",
                                            "accept": "image/*"}),
            "is_correct": forms.CheckboxInput(attrs={"class": "form-check-input kk-choice-correct-input"}),
            "correct_position": forms.NumberInput(attrs={"class": "form-control form-control-sm kk-choice-position-input",
                                                         "min": 0, "max": 8}),
            "order": forms.HiddenInput(attrs={"class": "kk-choice-order-input"}),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for name in ("text", "image", "is_correct", "correct_position", "order"):
            self.fields[name].required = False

    def clean(self):
        cleaned = super().clean()
        if cleaned.get("DELETE"):
            return cleaned
        cleaned["text"] = (cleaned.get("text") or "").strip()
        if cleaned.get("correct_position") is None:
            cleaned["correct_position"] = 0
        if cleaned.get("order") is None:
            cleaned["order"] = 0
        return cleaned

    @property
    def is_blank(self):
        """True when the author left this row untouched."""
        data = getattr(self, "cleaned_data", None) or {}
        has_image = bool(data.get("image")) or bool(getattr(self.instance, "image", None))
        return not data.get("text") and not has_image


class BaseGameChoiceFormSet(forms.BaseInlineFormSet):
    """Validates the answer set as a whole, against the question's type.

    The type can change in the same POST that edits the answers, so the view
    assigns `formset.question_type` from the submitted question form before
    calling `is_valid()`. Without that the formset would grade a puzzle
    against multiple-choice rules on the exact request that converts it.
    """

    question_type = None

    def _effective_type(self):
        return self.question_type or getattr(self.instance, "question_type", "mcq") or "mcq"

    def clean(self):
        super().clean()
        if any(self.errors):
            return

        live = [
            f for f in self.forms
            if getattr(f, "cleaned_data", None) and not f.cleaned_data.get("DELETE") and not f.is_blank
        ]

        if len(live) < 2:
            raise forms.ValidationError("A question needs at least two answers.")

        qtype = self._effective_type()

        if qtype == "puzzle":
            positions = [f.cleaned_data.get("correct_position") or 0 for f in live]
            expected = list(range(1, len(live) + 1))
            if sorted(positions) != expected:
                raise forms.ValidationError(
                    "Give every puzzle piece a different position, numbered 1 to "
                    f"{len(live)}."
                )
            return

        correct = [f for f in live if f.cleaned_data.get("is_correct")]
        if not correct:
            raise forms.ValidationError("Tick the answer that is correct.")
        if len(correct) > 1:
            raise forms.ValidationError("Only one answer can be correct. Untick the others.")

        if qtype == "picture_choice":
            missing = [
                f for f in live
                if not f.cleaned_data.get("image") and not getattr(f.instance, "image", None)
            ]
            if missing:
                raise forms.ValidationError(
                    "Picture questions need an image on every answer — "
                    f"{len(missing)} still missing."
                )


GameChoiceFormSet = forms.inlineformset_factory(
    GameQuestion,
    GameChoice,
    form=GameChoiceForm,
    formset=BaseGameChoiceFormSet,
    # Was `extra=4`, which meant opening a saved 4-answer question showed
    # eight rows: four real ones and four empty ones the author had to
    # mentally skip. New rows are added on demand from the editor instead.
    extra=0,
    max_num=8,
    validate_max=True,
    can_delete=True,
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
        cleaned["name"] = name
        if name and not slug:
            cleaned["slug"] = slugify(name) or "room"
        elif slug and not name:
            self.add_error("name", "Name is required.")
        # Stale ids from an older catalog would render as a blank door.
        cleaned["avatar_id"] = normalize_avatar_id(cleaned.get("avatar_id"))
        if cleaned.get("order") is None:
            cleaned["order"] = 0
        return cleaned


class BaseGameRoomFormSet(forms.BaseInlineFormSet):
    def clean(self):
        super().clean()
        if any(self.errors):
            return
        seen = set()
        for form in self.forms:
            data = getattr(form, "cleaned_data", None)
            if not data or data.get("DELETE"):
                continue
            name = (data.get("name") or "").strip().casefold()
            if not name:
                continue
            if name in seen:
                raise forms.ValidationError(
                    "Two rooms share the same name — players would not be able to tell them apart."
                )
            seen.add(name)


GameRoomFormSet = forms.inlineformset_factory(
    Quiz, GameRoom, form=GameRoomForm, formset=BaseGameRoomFormSet, extra=0, can_delete=True,
)
