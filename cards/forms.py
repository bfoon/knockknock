from django import forms

from .models import Card, Message


class CardForm(forms.ModelForm):
    class Meta:
        model = Card
        fields = [
            "title",
            "recipient_name",
            "occasion",
            "template",
            "background_mode",
            "background_pattern",
            "custom_background",
            "recipient_photo",
            "intro_note",
            "moderated",
        ]
        widgets = {
            "title": forms.TextInput(
                attrs={"placeholder": "e.g. Farewell to Amina!", "class": "eo-input"}
            ),
            "recipient_name": forms.TextInput(
                attrs={"placeholder": "Who is this card for?", "class": "eo-input"}
            ),
            "occasion": forms.Select(attrs={"class": "eo-input"}),
            "template": forms.Select(attrs={"class": "eo-input"}),
            # The picker UI sets these hidden inputs; no visible <select>/<input>.
            "background_mode": forms.HiddenInput(attrs={"id": "id_background_mode"}),
            "background_pattern": forms.HiddenInput(attrs={"id": "id_background_pattern"}),
            "intro_note": forms.Textarea(
                attrs={
                    "rows": 3,
                    "placeholder": "A short note from you (optional)",
                    "class": "eo-input",
                }
            ),
        }

    def clean(self):
        cleaned = super().clean()
        mode = cleaned.get("background_mode")
        has_image = cleaned.get("custom_background") or (
            self.instance and self.instance.custom_background
        )
        # Guard against half-finished selections so a card never renders blank.
        if mode == "custom" and not has_image:
            cleaned["background_mode"] = "floral"
        if mode == "pattern" and not cleaned.get("background_pattern"):
            cleaned["background_mode"] = "floral"
        return cleaned


class MessageForm(forms.ModelForm):
    class Meta:
        model = Message
        fields = ["author_name", "body", "color"]
        widgets = {
            "author_name": forms.TextInput(
                attrs={"placeholder": "Your name", "class": "eo-input"}
            ),
            "body": forms.Textarea(
                attrs={
                    "rows": 4,
                    "maxlength": 600,
                    "placeholder": "Write something heartfelt…",
                    "class": "eo-input",
                }
            ),
            "color": forms.RadioSelect(),
        }
