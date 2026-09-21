from django.contrib import admin

from .models import (
    Deck, Slide, DeckCollaborator, DeckInvite, DeckReaction, BigScreen, ScreenShare,
)


class SlideInline(admin.TabularInline):
    model = Slide
    extra = 0
    fields = ("position",)
    ordering = ("position",)


@admin.register(Deck)
class DeckAdmin(admin.ModelAdmin):
    list_display = ("title", "code", "owner", "state", "allow_reactions", "current_slide", "updated_at")
    list_filter = ("state", "allow_reactions")
    search_fields = ("title", "code", "owner__username", "owner__email")
    readonly_fields = ("code", "created_at", "updated_at")
    inlines = [SlideInline]


@admin.register(Slide)
class SlideAdmin(admin.ModelAdmin):
    list_display = ("deck", "position")
    ordering = ("deck", "position")
    search_fields = ("deck__title", "deck__code")


@admin.register(DeckCollaborator)
class DeckCollaboratorAdmin(admin.ModelAdmin):
    list_display = ("deck", "user", "permission", "invited_by", "accepted_at", "created_at")
    list_filter = ("permission",)
    search_fields = ("deck__title", "deck__code", "user__username", "user__email")


@admin.register(DeckInvite)
class DeckInviteAdmin(admin.ModelAdmin):
    list_display = ("deck", "email", "status", "permission", "invited_by", "accepted_by", "created_at")
    list_filter = ("status", "permission")
    search_fields = ("deck__title", "deck__code", "email")
    readonly_fields = ("token", "created_at", "accepted_at")


@admin.register(DeckReaction)
class DeckReactionAdmin(admin.ModelAdmin):
    list_display = ("deck", "emoji", "slide_index", "nick", "created_at")
    list_filter = ("emoji", "created_at")
    search_fields = ("deck__title", "deck__code", "emoji", "nick")
    readonly_fields = ("created_at",)


class ScreenShareInline(admin.TabularInline):
    model = ScreenShare
    extra = 0
    fields = ("deck", "sharer_name", "status", "created_at", "went_live_at", "closed_at")
    readonly_fields = fields
    can_delete = False
    show_change_link = True


@admin.register(BigScreen)
class BigScreenAdmin(admin.ModelAdmin):
    list_display = ("name", "owner", "is_active", "share_code", "current_share", "created_at", "ended_at")
    list_filter = ("is_active",)
    search_fields = ("name", "owner__username", "owner__email", "share_code")
    # The token IS the screen's key. Readable here for support, never editable.
    readonly_fields = ("token", "share_code", "created_at", "ended_at", "last_seen_at")
    inlines = [ScreenShareInline]


@admin.register(ScreenShare)
class ScreenShareAdmin(admin.ModelAdmin):
    list_display = ("deck", "screen", "sharer_name", "status", "created_at", "went_live_at")
    list_filter = ("status",)
    search_fields = ("deck__title", "deck__code", "sharer_name", "screen__name")
    readonly_fields = ("control_code", "control_code_at", "created_at", "went_live_at", "closed_at")
