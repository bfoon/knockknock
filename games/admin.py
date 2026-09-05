from django.contrib import admin

from .models import GameAnswer, GameChoice, GameQuestion, GameRoom, Quiz


class GameChoiceInline(admin.TabularInline):
    model = GameChoice
    extra = 1


class GameRoomInline(admin.TabularInline):
    model = GameRoom
    extra = 0
    prepopulated_fields = {"slug": ("name",)}


@admin.register(Quiz)
class QuizAdmin(admin.ModelAdmin):
    list_display = ("title", "owner", "scoring", "mode", "use_rooms", "chart_background", "updated_at")
    list_filter = ("scoring", "mode", "use_rooms", "chart_background")
    search_fields = ("title", "description", "owner__username")
    date_hierarchy = "updated_at"
    inlines = [GameRoomInline]


@admin.register(GameQuestion)
class GameQuestionAdmin(admin.ModelAdmin):
    list_display = ("text", "quiz", "question_type", "time_limit", "points", "order", "font_family")
    list_filter = ("question_type", "font_family")
    search_fields = ("text", "quiz__title")
    # Without this the change form renders a <select> containing every quiz
    # in the database.
    raw_id_fields = ("quiz",)
    inlines = [GameChoiceInline]


@admin.register(GameAnswer)
class GameAnswerAdmin(admin.ModelAdmin):
    """GameAnswer was registered bare, with no ModelAdmin.

    That gives the changelist no filters, no search and no pagination hints,
    and — worse — a change form whose `question`, `session` and `choice`
    dropdowns each render every row in those tables. This is the fastest
    growing table in the app: one row per player per question per session.
    A single classroom term will make that page unopenable.

    It is also read-only here. These rows are the record of what happened in
    a live session; editing one silently desynchronises it from the
    denormalised Participant.score, and nothing recomputes.
    """

    list_display = ("nickname", "session", "question", "is_correct", "points_awarded",
                    "was_late", "time_taken_ms", "created_at")
    list_filter = ("is_correct", "was_late", "session__kind", "created_at")
    search_fields = ("nickname", "participant_id", "session__code")
    date_hierarchy = "created_at"
    raw_id_fields = ("question", "session", "choice")
    list_select_related = ("session", "question")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(GameRoom)
class GameRoomAdmin(admin.ModelAdmin):
    """GameRoom had no admin at all, so a bad slug could only be fixed in a shell."""

    list_display = ("name", "quiz", "slug", "avatar_id", "order")
    list_filter = ("quiz",)
    search_fields = ("name", "slug", "quiz__title")
    raw_id_fields = ("quiz",)
