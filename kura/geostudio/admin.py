from django.contrib import admin

from .models import (Analysis, CarbonAsset, Feature, GeofenceEvent, GeoProject, ImageryLayer, LandEvent,
                     LocationRecord, Tracker)


@admin.register(GeoProject)
class GeoProjectAdmin(admin.ModelAdmin):
    list_display = ("title", "owner", "purpose", "survey", "is_public", "updated_at")
    list_filter = ("purpose", "is_public")
    search_fields = ("title", "owner__username")


@admin.register(Feature)
class FeatureAdmin(admin.ModelAdmin):
    list_display = ("__str__", "project", "category", "layer", "area_m2", "is_geofence")
    list_filter = ("category", "is_geofence")
    search_fields = ("name",)


class LandEventInline(admin.TabularInline):
    model = LandEvent
    extra = 0
    can_delete = False
    readonly_fields = ("seq", "kind", "party_name", "details", "actor_name", "prev_hash", "hash", "created_at")

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(LocationRecord)
class LocationRecordAdmin(admin.ModelAdmin):
    """Read-mostly: the registry is changed through the studio so every
    change lands in the hash chain."""
    list_display = ("code", "label", "holder_name", "tenure", "status", "area_m2", "created_at")
    list_filter = ("status", "tenure")
    search_fields = ("code", "label", "holder_name", "plus_code")
    readonly_fields = ("code", "geometry_hash", "geometry", "plus_code", "centroid_lat", "centroid_lng",
                       "area_m2", "head_hash", "holder_name", "status")
    inlines = [LandEventInline]


admin.site.register(Analysis)
admin.site.register(CarbonAsset)
admin.site.register(ImageryLayer)
admin.site.register(Tracker)
admin.site.register(GeofenceEvent)
