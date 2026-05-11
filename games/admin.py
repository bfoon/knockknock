from django.contrib import admin
from .models import Quiz, GameQuestion, GameChoice, GameAnswer


class GameChoiceInline(admin.TabularInline):
    model = GameChoice
    extra = 1


@admin.register(Quiz)
class QuizAdmin(admin.ModelAdmin):
    list_display = ("title", "owner", "scoring", "mode", "use_rooms", "chart_background", "updated_at")


@admin.register(GameQuestion)
class GameQuestionAdmin(admin.ModelAdmin):
    list_display = ("text", "quiz", "time_limit", "points", "order", "font_family")
    inlines = [GameChoiceInline]


admin.site.register(GameAnswer)