from django.contrib import admin

from .models import (
    AttendanceEvent, EventField, Registration, RegistrationAnswer,
    EventAnnouncement, Certificate,
)


class EventFieldInline(admin.TabularInline):
    model = EventField
    extra = 0
    fields = ("order", "label", "field_type", "required", "preset_key")
    ordering = ("order",)


@admin.register(AttendanceEvent)
class AttendanceEventAdmin(admin.ModelAdmin):
    list_display = ("title", "owner", "starts_at", "status",
                    "registration_mode", "capacity")
    list_filter = ("status", "registration_mode", "starts_at")
    search_fields = ("title", "owner__username", "owner__email")
    inlines = [EventFieldInline]
    readonly_fields = ("code", "public_token", "created_at", "updated_at")


class RegistrationAnswerInline(admin.TabularInline):
    model = RegistrationAnswer
    extra = 0


@admin.register(Registration)
class RegistrationAdmin(admin.ModelAdmin):
    list_display = ("display_name", "event", "status", "is_walk_in",
                    "registered_at", "checked_in_at")
    list_filter = ("status", "is_walk_in", "event")
    search_fields = ("full_name", "email", "phone", "event__title")
    inlines = [RegistrationAnswerInline]
    readonly_fields = ("token", "registered_at", "accepted_at", "checked_in_at")


admin.site.register(EventAnnouncement)
admin.site.register(Certificate)
