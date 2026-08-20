from django.contrib import admin

from .models import Board, BoardImage, BoardPage, BoardSession


class BoardPageInline(admin.TabularInline):
    model = BoardPage
    extra = 0
    fields = ("index", "stroke_count", "el_count", "updated_at")
    readonly_fields = ("index", "stroke_count", "el_count", "updated_at")
    can_delete = False

    @admin.display(description="Strokes")
    def stroke_count(self, obj):
        return len(obj.strokes or [])

    @admin.display(description="Objects")
    def el_count(self, obj):
        return len(obj.els or [])


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


@admin.register(BoardImage)
class BoardImageAdmin(admin.ModelAdmin):
    list_display = ("file", "board", "uploaded_at")
    list_filter = ("uploaded_at",)
    search_fields = ("board__title",)
    readonly_fields = ("uploaded_at",)
