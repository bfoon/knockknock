from django.contrib import admin

from .models import Topic, Comment, TopicLike, CommentLike


@admin.register(Topic)
class TopicAdmin(admin.ModelAdmin):
    list_display = ("title", "author", "category", "created_at",
                    "is_pinned", "is_locked", "is_removed")
    list_filter = ("category", "is_pinned", "is_locked", "is_removed")
    search_fields = ("title", "body", "author__username", "author__email")
    actions = ["pin_topics", "unpin_topics", "lock_topics", "unlock_topics",
               "remove_topics", "restore_topics"]

    @admin.action(description="Pin selected topics")
    def pin_topics(self, request, queryset):
        queryset.update(is_pinned=True)

    @admin.action(description="Unpin selected topics")
    def unpin_topics(self, request, queryset):
        queryset.update(is_pinned=False)

    @admin.action(description="Lock selected topics")
    def lock_topics(self, request, queryset):
        queryset.update(is_locked=True)

    @admin.action(description="Unlock selected topics")
    def unlock_topics(self, request, queryset):
        queryset.update(is_locked=False)

    @admin.action(description="Remove (hide) selected topics")
    def remove_topics(self, request, queryset):
        queryset.update(is_removed=True)

    @admin.action(description="Restore selected topics")
    def restore_topics(self, request, queryset):
        queryset.update(is_removed=False)


@admin.register(Comment)
class CommentAdmin(admin.ModelAdmin):
    list_display = ("author", "topic", "created_at", "is_removed")
    list_filter = ("is_removed",)
    search_fields = ("body", "author__username")


admin.site.register(TopicLike)
admin.site.register(CommentLike)
