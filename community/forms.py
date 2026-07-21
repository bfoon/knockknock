from django import forms

from .models import Topic, Comment


class TopicForm(forms.ModelForm):
    class Meta:
        model = Topic
        fields = ["title", "category", "body"]
        widgets = {
            "title": forms.TextInput(attrs={
                "class": "form-control",
                "placeholder": "What do you want to talk about?",
                "maxlength": 200,
                "autofocus": True,
            }),
            "category": forms.Select(attrs={"class": "form-select"}),
            "body": forms.Textarea(attrs={
                "class": "form-control",
                "rows": 8,
                "placeholder": ("Share the details — what happened, what you built, "
                                "or what you'd like to see in Knock-Knock…"),
            }),
        }

    def clean_title(self):
        title = (self.cleaned_data.get("title") or "").strip()
        if len(title) < 5:
            raise forms.ValidationError("Give your topic a slightly longer title (5+ characters).")
        return title

    def clean_body(self):
        body = (self.cleaned_data.get("body") or "").strip()
        if len(body) < 10:
            raise forms.ValidationError("Add a bit more detail so people can respond (10+ characters).")
        return body


class CommentForm(forms.ModelForm):
    # Hidden field set by the "Reply" buttons in the template.
    parent_id = forms.IntegerField(required=False, widget=forms.HiddenInput())

    class Meta:
        model = Comment
        fields = ["body"]
        widgets = {
            "body": forms.Textarea(attrs={
                "class": "form-control",
                "rows": 3,
                "placeholder": "Write a comment…",
            }),
        }

    def clean_body(self):
        body = (self.cleaned_data.get("body") or "").strip()
        if not body:
            raise forms.ValidationError("Comment can't be empty.")
        return body
