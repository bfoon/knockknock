"""
Venue registry + global site settings for the attendance app.

Kept in its own module so the diff against the (large) main models.py
is small: one `from .venue_models import Venue, SiteSetting` at the top,
and one `venue = ForeignKey(Venue, ...)` on AttendanceEvent.

Permission model
────────────────
Two kinds of venues live in this table:

  - Global venues (organization=None, is_global=True).
    Only a Django superuser can create these. They appear in every
    organizer's picker.

  - Org venues (organization=<some org>, is_global=False).
    Only an Admin of a Corporate-tier organization can create these.
    They appear only to members of that org.

Free / individual users see no venue picker at all — they still type
lat/lng manually on the event form, which keeps their flow unchanged.
"""

from django.conf import settings
from django.db import models


# ── Configurable global default radius ──────────────────────────────
DEFAULT_GEOFENCE_RADIUS_M = 150


class SiteSetting(models.Model):
    """
    Singleton row holding tunables the super-admin owns.

    There's only ever one row (pk=1). Helpers below load-or-create it
    on demand so the rest of the app can just call `SiteSetting.current()`
    without worrying about migrations seeding it.
    """

    default_geofence_radius_m = models.PositiveIntegerField(
        default=DEFAULT_GEOFENCE_RADIUS_M,
        help_text="Fallback radius (metres) applied to new venues when "
                  "the creator doesn't specify one.",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Site setting"
        verbose_name_plural = "Site settings"

    def __str__(self):
        return f"SiteSetting (radius={self.default_geofence_radius_m}m)"

    @classmethod
    def current(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class Venue(models.Model):
    """
    A reusable, pre-geocoded location an organizer can drop onto an event.

    `organization` is null for global (super-admin) venues. The unique
    constraint allows the same name across orgs but prevents duplicate
    names within one scope, so an organizer's dropdown won't have two
    "Main Office" entries.
    """

    # FK scope. We import the Organization model lazily via the string
    # form so this module doesn't drag in the organizations app eagerly.
    organization = models.ForeignKey(
        "organizations.Organization",
        on_delete=models.CASCADE,
        related_name="venues",
        null=True, blank=True,
        help_text="Null = global venue, visible to every organizer.",
    )
    is_global = models.BooleanField(
        default=False,
        help_text="Mirrors organization is null. Kept as a denormalized "
                  "flag so list queries can index on a single field.",
    )

    name = models.CharField(max_length=160)
    address = models.CharField(max_length=300, blank=True)

    latitude = models.FloatField()
    longitude = models.FloatField()
    default_radius_m = models.PositiveIntegerField(
        default=DEFAULT_GEOFENCE_RADIUS_M,
        help_text="Suggested geofence radius for events at this venue. "
                  "Organizers can override per event.",
    )

    is_active = models.BooleanField(default=True)
    notes = models.TextField(blank=True)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="venues_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("name",)
        constraints = [
            # No duplicate names within the same scope (global, or one org).
            # SQLite + Postgres both treat NULL as distinct in unique
            # indexes, which is exactly what we want — multiple orgs
            # can have "Main Office" without collision.
            models.UniqueConstraint(
                fields=("organization", "name"),
                name="uniq_venue_scope_name",
            ),
            # Coords sanity. World bounds.
            models.CheckConstraint(
                check=models.Q(latitude__gte=-90, latitude__lte=90),
                name="venue_lat_in_range",
            ),
            models.CheckConstraint(
                check=models.Q(longitude__gte=-180, longitude__lte=180),
                name="venue_lng_in_range",
            ),
        ]
        indexes = [
            models.Index(fields=["is_global", "is_active"]),
            models.Index(fields=["organization", "is_active"]),
        ]

    def __str__(self):
        scope = "global" if self.is_global else (
            self.organization.name if self.organization_id else "scoped"
        )
        return f"{self.name} ({scope})"

    def save(self, *args, **kwargs):
        # Keep is_global and organization in sync so the dashboard list
        # query can stay a single index lookup. If somebody flips this
        # via the admin, the flag reflects reality after save.
        self.is_global = self.organization_id is None
        super().save(*args, **kwargs)

    # ── Visibility helpers ──────────────────────────────────────────
    @classmethod
    def visible_to(cls, user):
        """
        Return the queryset of active venues this user is allowed to see
        on their event-create form.

          - Anonymous / unauthenticated: nothing.
          - Authenticated: every global venue, plus venues belonging to
            corporate orgs they're an active member of.
        """
        if not getattr(user, "is_authenticated", False):
            return cls.objects.none()

        # Import here to avoid an import cycle at module load.
        from organizations.models import Membership, Organization

        org_ids = list(
            Membership.objects
            .filter(
                user=user,
                status=Membership.STATUS_ACTIVE,
                organization__kind=Organization.KIND_CORPORATE,
            )
            .values_list("organization_id", flat=True)
        )

        return cls.objects.filter(is_active=True).filter(
            models.Q(is_global=True) | models.Q(organization_id__in=org_ids)
        )

    # ── Permission helpers ──────────────────────────────────────────
    @staticmethod
    def can_create_global(user):
        """Only superusers can publish global venues."""
        return bool(getattr(user, "is_authenticated", False)
                    and user.is_superuser)

    @staticmethod
    def can_create_for_org(user, organization):
        """Corporate-tier org Admins can publish venues for their org."""
        if not getattr(user, "is_authenticated", False):
            return False
        if user.is_superuser:
            return True
        if organization is None:
            return False
        from organizations.models import Membership, Organization as Org
        if organization.kind != Org.KIND_CORPORATE:
            return False
        return Membership.objects.filter(
            user=user, organization=organization,
            status=Membership.STATUS_ACTIVE,
            role=Membership.ROLE_ADMIN,
        ).exists()

    def can_edit(self, user):
        if not getattr(user, "is_authenticated", False):
            return False
        if user.is_superuser:
            return True
        if self.organization_id is None:
            return False  # global, but user isn't superuser
        return Venue.can_create_for_org(user, self.organization)
