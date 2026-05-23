from django.contrib import admin

from .models import Deck, Slide


class SlideInline(admin.TabularInline):
    model = Slide
    extra = 0
    fields = ("position",)
    ordering = ("position",)


@admin.register(Deck)
class DeckAdmin(admin.ModelAdmin):
    list_display = ("title", "code", "owner", "state", "updated_at")
    list_filter = ("state",)
    search_fields = ("title", "code")
    readonly_fields = ("code", "created_at", "updated_at")
    inlines = [SlideInline]


@admin.register(Slide)
class SlideAdmin(admin.ModelAdmin):
    list_display = ("deck", "position")
    ordering = ("deck", "position")
