from django.contrib import admin

from .models import GameNight, Match, Player


class PlayerInline(admin.TabularInline):
    model = Player
    extra = 0
    fields = ("name", "avatar_id", "points", "wins", "draws", "losses", "kills", "kicked")
    readonly_fields = ("name",)


@admin.register(GameNight)
class GameNightAdmin(admin.ModelAdmin):
    list_display = ("title", "code", "owner", "game", "state", "round", "created_at")
    search_fields = ("title", "code", "owner__username")
    inlines = [PlayerInline]


@admin.register(Match)
class MatchAdmin(admin.ModelAdmin):
    list_display = ("night", "round", "table", "game", "status", "version", "updated_at")
    list_filter = ("game", "status")
