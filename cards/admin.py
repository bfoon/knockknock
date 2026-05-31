from django.contrib import admin

from .models import Card, Message, Reaction


class MessageInline(admin.TabularInline):
    model = Message
    extra = 0
    readonly_fields = ("created_at",)


@admin.register(Card)
class CardAdmin(admin.ModelAdmin):
    list_display = (
        "title",
        "recipient_name",
        "occasion",
        "template",
        "is_closed",
        "moderated",
        "created_by",
        "created_at",
    )
    list_filter = ("occasion", "template", "is_closed", "moderated")
    search_fields = ("title", "recipient_name", "token")
    readonly_fields = ("token", "created_at", "closed_at")
    inlines = [MessageInline]


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ("author_name", "card", "color", "is_approved", "created_at")
    list_filter = ("is_approved", "color")
    search_fields = ("author_name", "body")


@admin.register(Reaction)
class ReactionAdmin(admin.ModelAdmin):
    list_display = ("emoji", "card", "created_at")
    list_filter = ("emoji",)
