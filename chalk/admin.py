from django.contrib import admin

from .models import Board, BoardPage, BoardSession


class BoardPageInline(admin.TabularInline):
    model = BoardPage
    extra = 0
    fields = ("index", "stroke_count", "updated_at")
    readonly_fields = ("index", "stroke_count", "updated_at")
    can_delete = False

    @admin.display(description="Strokes")
    def stroke_count(self, obj):
        return len(obj.strokes or [])


@admin.register(Board)
class BoardAdmin(admin.ModelAdmin):
    list_display = ("title", "owner", "surface", "updated_at")
    list_filter = ("surface", "created_at")
    search_fields = ("title", "owner__username", "owner__email")
    readonly_fields = ("created_at", "updated_at")
    inlines = [BoardPageInline]


@admin.register(BoardSession)
class BoardSessionAdmin(admin.ModelAdmin):
    list_display = ("board", "code", "page_index", "rotated_at")
    search_fields = ("code", "board__title")
    readonly_fields = ("code", "token", "created_at", "rotated_at")
