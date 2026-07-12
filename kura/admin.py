from django.contrib import admin

from .models import (
    AnswerEdit, CleaningRule, Device, FormVersion, Submission,
    SubmissionFlag, Survey, SyncLog,
)


@admin.register(Survey)
class SurveyAdmin(admin.ModelAdmin):
    list_display = ("title", "code", "owner", "state", "quota", "updated_at")
    search_fields = ("title", "code")
    list_filter = ("state",)


@admin.register(FormVersion)
class FormVersionAdmin(admin.ModelAdmin):
    list_display = ("survey", "version", "is_current", "published_by", "published_at")
    list_filter = ("is_current",)


@admin.register(Submission)
class SubmissionAdmin(admin.ModelAdmin):
    list_display = ("client_uuid", "survey", "status", "source", "device",
                    "received_at", "duration_ms")
    list_filter = ("status", "source")
    search_fields = ("client_uuid", "survey__code")


@admin.register(Device)
class DeviceAdmin(admin.ModelAdmin):
    list_display = ("name", "user", "platform", "is_active", "last_seen")
    list_filter = ("is_active", "platform")


admin.site.register(AnswerEdit)
admin.site.register(CleaningRule)
admin.site.register(SubmissionFlag)
admin.site.register(SyncLog)
