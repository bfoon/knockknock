"""
accounts/admin.py — accounts in the backend, plus a platform analytics page.

The dashboard lives at /admin/accounts/usersession/analytics/ (there's a
button on the sessions changelist). It's hung off a ModelAdmin's get_urls()
rather than a custom AdminSite so nothing about the existing admin setup
has to change.
"""

from datetime import timedelta

from django.contrib import admin, messages
from django.db.models import Count, Sum
from django.db.models.functions import TruncDate
from django.shortcuts import render
from django.urls import path, reverse
from django.utils import timezone
from django.utils.html import format_html

from .models import AppUsage, AppUsageUser, Profile, UserSession, app_label_for


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ("display_name", "user", "last_login_at",
                    "last_login_device", "last_login_ip", "created_at")
    list_filter = ("created_at", "last_login_at")
    search_fields = ("display_name", "user__username", "user__email",
                     "last_login_ip")
    readonly_fields = ("created_at", "last_login_at", "previous_login_at",
                       "last_login_ip", "last_login_device")
    fieldsets = (
        (None, {"fields": ("user", "display_name", "bio")}),
        ("Branding", {"fields": ("logo", "brand_color")}),
        ("Sign-in history", {
            "fields": ("last_login_at", "previous_login_at",
                       "last_login_device", "last_login_ip", "created_at"),
            "description": "Maintained automatically on login — read only.",
        }),
    )


@admin.register(UserSession)
class UserSessionAdmin(admin.ModelAdmin):
    list_display = ("user", "device", "kind", "ip", "created_at", "last_seen")
    list_filter = ("kind", "created_at", "last_seen")
    search_fields = ("user__username", "user__email", "device", "ip",
                     "session_key")
    readonly_fields = ("user", "session_key", "ip", "user_agent", "device",
                       "kind", "created_at", "last_seen")
    date_hierarchy = "last_seen"
    actions = ("end_sessions",)
    change_list_template = "admin/accounts/usersession/change_list.html"

    def has_add_permission(self, request):
        return False   # rows are written by the login signal, never by hand

    @admin.action(description="End selected sessions (signs those devices out)")
    def end_sessions(self, request, queryset):
        count = 0
        for session in queryset:
            session.end()
            count += 1
        self.message_user(
            request, f"Ended {count} session(s).", messages.SUCCESS)

    # ── analytics page ───────────────────────────────────────────────
    def get_urls(self):
        return [
            path("analytics/", self.admin_site.admin_view(self.analytics_view),
                 name="accounts_platform_analytics"),
        ] + super().get_urls()

    def changelist_view(self, request, extra_context=None):
        extra_context = extra_context or {}
        extra_context["analytics_url"] = reverse(
            "admin:accounts_platform_analytics")
        return super().changelist_view(request, extra_context)

    def analytics_view(self, request):
        try:
            window = max(1, min(365, int(request.GET.get("days", 30))))
        except (TypeError, ValueError):
            window = 30

        now = timezone.now()
        today = timezone.localdate()
        since_date = today - timedelta(days=window - 1)
        since_dt = now - timedelta(days=window)

        User = Profile._meta.get_field("user").related_model

        # ── registrations ────────────────────────────────────────────
        users = User.objects.all()
        signups = (users.filter(date_joined__gte=since_dt)
                   .annotate(day=TruncDate("date_joined"))
                   .values("day").annotate(n=Count("id")).order_by("day"))
        signup_rows = list(signups)
        signup_peak = max((r["n"] for r in signup_rows), default=0)

        registrations = {
            "total": users.count(),
            "active_flag": users.filter(is_active=True).count(),
            "staff": users.filter(is_staff=True).count(),
            "last_7": users.filter(date_joined__gte=now - timedelta(days=7)).count(),
            "last_30": users.filter(date_joined__gte=now - timedelta(days=30)).count(),
            "in_window": users.filter(date_joined__gte=since_dt).count(),
            "never_signed_in": users.filter(last_login__isnull=True).count(),
        }

        # ── who is actually here ─────────────────────────────────────
        live = UserSession.objects.all()
        activity = {
            "signed_in_now": live.values("user").distinct().count(),
            "open_sessions": live.count(),
            "seen_24h": live.filter(last_seen__gte=now - timedelta(days=1))
                            .values("user").distinct().count(),
            "seen_7d": live.filter(last_seen__gte=now - timedelta(days=7))
                           .values("user").distinct().count(),
            "active_in_window": (AppUsageUser.objects
                                 .filter(day__gte=since_date)
                                 .values("user").distinct().count()),
        }
        multi = (live.values("user").annotate(n=Count("id"))
                     .filter(n__gt=1).count())
        activity["multi_device_users"] = multi

        # ── device mix ───────────────────────────────────────────────
        devices = list(live.values("kind").annotate(n=Count("id")).order_by("-n"))
        device_total = sum(d["n"] for d in devices) or 1
        for d in devices:
            d["label"] = dict(UserSession.KIND_CHOICES).get(d["kind"], d["kind"])
            d["pct"] = round(d["n"] * 100 / device_total)

        browsers = (live.exclude(device="")
                        .values("device").annotate(n=Count("id"))
                        .order_by("-n")[:8])

        # ── which part of the platform gets used ─────────────────────
        hits = (AppUsage.objects.filter(day__gte=since_date)
                .values("app").annotate(n=Sum("hits")).order_by("-n"))
        people = dict(AppUsageUser.objects.filter(day__gte=since_date)
                      .values("app").annotate(n=Count("user", distinct=True))
                      .values_list("app", "n"))
        hit_rows = list(hits)
        hit_peak = max((r["n"] for r in hit_rows), default=0) or 1
        sites = [{
            "app": r["app"],
            "label": app_label_for(r["app"]),
            "hits": r["n"],
            "users": people.get(r["app"], 0),
            "pct": round(r["n"] * 100 / hit_peak),
        } for r in hit_rows]

        tracking_started = (AppUsage.objects.order_by("day")
                            .values_list("day", flat=True).first())

        ctx = {
            **self.admin_site.each_context(request),
            "title": "Platform analytics",
            "window": window,
            "window_choices": (7, 30, 90, 365),
            "registrations": registrations,
            "activity": activity,
            "devices": devices,
            "browsers": browsers,
            "sites": sites,
            "top_site": sites[0] if sites else None,
            "signup_rows": signup_rows,
            "signup_peak": signup_peak or 1,
            "tracking_started": tracking_started,
            "opts": self.model._meta,
        }
        return render(request, "admin/accounts/analytics.html", ctx)


@admin.register(AppUsage)
class AppUsageAdmin(admin.ModelAdmin):
    list_display = ("day", "app_label", "app", "hits")
    list_filter = ("app", "day")
    date_hierarchy = "day"
    readonly_fields = ("app", "day", "hits")

    def has_add_permission(self, request):
        return False

    @admin.display(description="Area", ordering="app")
    def app_label(self, obj):
        return format_html("<strong>{}</strong>", obj.label)


@admin.register(AppUsageUser)
class AppUsageUserAdmin(admin.ModelAdmin):
    list_display = ("day", "app", "user")
    list_filter = ("app", "day")
    search_fields = ("user__username", "user__email")
    date_hierarchy = "day"
    readonly_fields = ("app", "day", "user")

    def has_add_permission(self, request):
        return False
