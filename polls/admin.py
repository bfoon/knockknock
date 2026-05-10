from django.contrib import admin
from .models import Questionnaire, Question, Choice, Response


class ChoiceInline(admin.TabularInline):
    model = Choice
    extra = 1


class QuestionInline(admin.StackedInline):
    model = Question
    extra = 0


@admin.register(Questionnaire)
class QuestionnaireAdmin(admin.ModelAdmin):
    list_display = ("title", "owner", "template_id", "mode", "updated_at")
    inlines = [QuestionInline]


@admin.register(Question)
class QuestionAdmin(admin.ModelAdmin):
    list_display = ("text", "questionnaire", "type", "chart_type", "order")
    inlines = [ChoiceInline]


admin.site.register(Response)
