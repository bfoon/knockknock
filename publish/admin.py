from django.contrib import admin
from django.utils import timezone

from .models import (MetricDay, Publication, PublicationAsset, PublicationAuthor,
                     PublicationBlock, PublicationVersion, ReviewNote, ShareEvent, Status, Tag)


class AuthorInline(admin.TabularInline):
    model = PublicationAuthor
    extra = 0


class AssetInline(admin.TabularInline):
    model = PublicationAsset
    extra = 0
    readonly_fields = ("checksum", "byte_size", "download_count", "created_at")


class BlockInline(admin.TabularInline):
    model = PublicationBlock
    extra = 0
    fields = ("order", "type", "caption")


@admin.register(Publication)
class PublicationAdmin(admin.ModelAdmin):
    list_display = ("title", "kind", "status", "owner", "version", "published_at",
                    "views_count", "downloads_count", "featured")
    list_filter = ("kind", "status", "visibility", "featured", "license")
    search_fields = ("title", "abstract", "citation_key", "slug", "owner__username")
    readonly_fields = ("citation_key", "created_at", "updated_at", "views_count",
                       "downloads_count", "shares_count")
    prepopulated_fields = {"slug": ("title",)}
    inlines = [AuthorInline, BlockInline, AssetInline]
    actions = ["approve_selected", "feature_selected", "unpublish_selected"]

    @admin.action(description="Approve and publish")
    def approve_selected(self, request, queryset):
        for pub in queryset:
            pub.mark_published(actor=request.user)
        self.message_user(request, "Published %d." % queryset.count())

    @admin.action(description="Feature on the home page")
    def feature_selected(self, request, queryset):
        queryset.update(featured=True, featured_at=timezone.now())

    @admin.action(description="Unpublish")
    def unpublish_selected(self, request, queryset):
        queryset.update(status=Status.DRAFT)


@admin.register(PublicationVersion)
class VersionAdmin(admin.ModelAdmin):
    list_display = ("publication", "number", "published_at", "created_by")
    readonly_fields = ("snapshot",)


@admin.register(ReviewNote)
class ReviewNoteAdmin(admin.ModelAdmin):
    list_display = ("publication", "decision", "author", "created_at")
    list_filter = ("decision",)


@admin.register(MetricDay)
class MetricDayAdmin(admin.ModelAdmin):
    list_display = ("publication", "day", "views", "downloads", "shares")
    list_filter = ("day",)


@admin.register(ShareEvent)
class ShareEventAdmin(admin.ModelAdmin):
    list_display = ("publication", "channel", "created_at")
    list_filter = ("channel",)


admin.site.register(Tag)
