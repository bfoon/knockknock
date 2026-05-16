"""
Venue management views — list, create, edit, (soft-)delete.

The picker URLs are mounted under /attendance/venues/. Free users
should never reach these pages through the UI (the dashboard entry
points are gated), but the views also enforce permissions server-side
in case someone hits a URL directly.
"""

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.http import HttpResponseForbidden, HttpResponseBadRequest
from django.shortcuts import get_object_or_404, redirect, render

from organizations.models import Membership, Organization

from .venue_models import Venue, SiteSetting
from .venue_forms import VenueForm, SiteSettingForm


# ─────────────────────────── List ───────────────────────────

@login_required
def venue_list(request):
    """
    Shows the venues this user can see, grouped by scope.

    Free / individual users get a friendly empty state explaining the
    feature is a Corporate add-on (we don't 403 — that would feel
    punitive — we just have nothing to show them).
    """
    venues = Venue.visible_to(request.user).select_related("organization")
    globals_qs = [v for v in venues if v.is_global]
    org_qs = [v for v in venues if not v.is_global]

    # What this user could create:
    can_create_global = Venue.can_create_global(request.user)
    creatable_orgs = _corporate_admin_orgs(request.user)

    site = SiteSetting.current() if request.user.is_superuser else None

    return render(request, "attendance/venue_list.html", {
        "global_venues": globals_qs,
        "org_venues": org_qs,
        "can_create_global": can_create_global,
        "creatable_orgs": creatable_orgs,
        "site_setting": site,
    })


# ─────────────────────────── Create ───────────────────────────

@login_required
def venue_create(request):
    """
    Two creation paths funnel through here, distinguished by ?scope=
    on the URL:

      ?scope=global       — super-admin only
      ?scope=org&org=<id> — corporate org admin
    """
    scope = request.GET.get("scope") or request.POST.get("scope") or "org"
    organization = None

    if scope == "global":
        if not Venue.can_create_global(request.user):
            return HttpResponseForbidden("Only the site admin can add global venues.")
    else:
        org_id = request.GET.get("org") or request.POST.get("org")
        if not org_id:
            return HttpResponseBadRequest("Missing org id.")
        organization = get_object_or_404(Organization, pk=org_id)
        if not Venue.can_create_for_org(request.user, organization):
            return HttpResponseForbidden("You're not a corporate admin for this org.")

    default_radius = SiteSetting.current().default_geofence_radius_m

    if request.method == "POST":
        form = VenueForm(request.POST)
        if form.is_valid():
            venue = form.save(commit=False)
            venue.organization = organization  # None for global
            venue.created_by = request.user
            # Apply the global default radius when blank.
            if not venue.default_radius_m:
                venue.default_radius_m = default_radius
            venue.save()
            messages.success(request, f"Saved venue '{venue.name}'.")
            return redirect("attendance:venue_list")
    else:
        form = VenueForm(initial={"default_radius_m": default_radius})

    return render(request, "attendance/venue_form.html", {
        "form": form,
        "scope": scope,
        "organization": organization,
        "is_new": True,
        "default_radius": default_radius,
    })


# ─────────────────────────── Edit ───────────────────────────

@login_required
def venue_edit(request, pk):
    venue = get_object_or_404(Venue, pk=pk)
    if not venue.can_edit(request.user):
        return HttpResponseForbidden("You can't edit this venue.")

    if request.method == "POST":
        form = VenueForm(request.POST, instance=venue)
        if form.is_valid():
            form.save()
            messages.success(request, f"Updated '{venue.name}'.")
            return redirect("attendance:venue_list")
    else:
        form = VenueForm(instance=venue)

    return render(request, "attendance/venue_form.html", {
        "form": form,
        "venue": venue,
        "scope": "global" if venue.is_global else "org",
        "organization": venue.organization,
        "is_new": False,
        "default_radius": SiteSetting.current().default_geofence_radius_m,
    })


# ─────────────────────────── Delete (deactivate) ───────────────────────────

@login_required
def venue_delete(request, pk):
    """
    Soft delete by flipping is_active off. Hard-delete would orphan any
    AttendanceEvent that referenced this venue; events keep their cached
    lat/lng/radius columns either way, so deactivation is the safe move.
    """
    venue = get_object_or_404(Venue, pk=pk)
    if not venue.can_edit(request.user):
        return HttpResponseForbidden("You can't delete this venue.")
    if request.method != "POST":
        return HttpResponseBadRequest("POST only.")
    venue.is_active = False
    venue.save(update_fields=["is_active", "updated_at"])
    messages.info(request, f"Deactivated '{venue.name}'.")
    return redirect("attendance:venue_list")


# ─────────────────────────── Site settings (super-admin) ───────────────────────────

@login_required
def site_settings(request):
    if not request.user.is_superuser:
        return HttpResponseForbidden("Site admin only.")
    obj = SiteSetting.current()
    if request.method == "POST":
        form = SiteSettingForm(request.POST, instance=obj)
        if form.is_valid():
            form.save()
            messages.success(request, "Site settings updated.")
            return redirect("attendance:venue_list")
    else:
        form = SiteSettingForm(instance=obj)
    return render(request, "attendance/site_settings.html", {"form": form})


# ─────────────────────────── helpers ───────────────────────────

def _corporate_admin_orgs(user):
    """The orgs this user can add venues to (i.e. admin of a corporate org)."""
    if user.is_superuser:
        return list(Organization.objects.filter(kind=Organization.KIND_CORPORATE))
    return list(
        Organization.objects.filter(
            kind=Organization.KIND_CORPORATE,
            memberships__user=user,
            memberships__status=Membership.STATUS_ACTIVE,
            memberships__role=Membership.ROLE_ADMIN,
        ).distinct()
    )
