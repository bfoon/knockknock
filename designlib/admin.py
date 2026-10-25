from django.contrib import admin

from .models import DesignBookmark


@admin.register(DesignBookmark)
class DesignBookmarkAdmin(admin.ModelAdmin):
    list_display = ("name", "owner", "kind", "uses", "pinned", "created_at")
    list_filter = ("kind", "pinned")
    search_fields = ("name", "owner__username", "prompt")
