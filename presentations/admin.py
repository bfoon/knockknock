from django.contrib import admin
from .models import LiveSession, Participant


@admin.register(LiveSession)
class LiveSessionAdmin(admin.ModelAdmin):
    list_display = ("code", "kind", "owner", "state", "mode", "current_question_index", "created_at")


@admin.register(Participant)
class ParticipantAdmin(admin.ModelAdmin):
    list_display = ("nickname", "session", "avatar_id", "room_id", "score", "joined_at")
