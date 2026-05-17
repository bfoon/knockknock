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
    organizer's picker — on ALL plans (free, individual, team,
    corporate). Think of them as a pre-curated public registry of
    well-known meeting locations the superuser has vetted.

  - Org venues (organization=<some org>, is_global=False).
    Only an Admin of a Corporate-tier organization can create these.
    They appear only to members of that org.

Free / individual / team users now see the picker — populated with
global venues. They can still type custom lat/lng manually, and any
saved venue's default radius can be overridden per-event.

Advertised venues
─────────────────
Global venues can additionally be flagged `advertise=True` by the
superuser. Advertised venues are rendered on the public homepage
(only to logged-out visitors) as a marketing showcase. Each ad gets
an image, tagline and longer description so the venue can present
itself properly. Non-advertised global venues still work in the
picker — they're just not promoted on the homepage.
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
        help_text="Null = global venue, visible to every organizer on every plan.",
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
                  "Organizers on any plan can override per event.",
    )

    is_active = models.BooleanField(default=True)
    notes = models.TextField(blank=True)

    # ── Advertisement fields (super-admin only, global venues only) ──
    # When `advertise=True` on a global venue, the public homepage
    # renders a card with image + tagline + short description so
    # visitors can discover the venue. These fields are ignored on
    # org-scoped venues — even if set, the homepage never reads them
    # for non-global rows.
    advertise = models.BooleanField(
        default=False,
        help_text="Show this venue on the public homepage as an advertisement. "
                  "Only honoured for global venues — super-admin only.",
    )
    image = models.ImageField(
        upload_to="venues/ads/", blank=True, null=True,
        help_text="Hero image for the homepage ad and the venue detail page. "
                  "Landscape, ~1200×800 works best.",
    )
    tagline = models.CharField(
        max_length=160, blank=True,
        help_text="One-line pitch shown under the venue name on the homepage card.",
    )
    description = models.TextField(
        blank=True,
        help_text="Longer description shown on the public venue detail page. "
                  "Plain text or simple HTML.",
    )
    contact_email = models.EmailField(
        blank=True,
        help_text="Optional public contact for venue enquiries on the ad page.",
    )
    contact_phone = models.CharField(
        max_length=40, blank=True,
        help_text="Optional public contact phone for venue enquiries.",
    )
    website_url = models.URLField(
        blank=True,
        help_text="Optional external website link for the venue ad page.",
    )
    advertise_order = models.PositiveIntegerField(
        default=0,
        help_text="Sort order on the homepage. Lower numbers appear first. "
                  "Ties broken by name.",
    )

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
            # Powers the homepage advertisement listing.
            models.Index(fields=["advertise", "is_active", "advertise_order"]),
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
        # Belt and braces: never let `advertise` stay true on a
        # non-global venue. Only the super-admin's global registry
        # should appear on the marketing homepage.
        if not self.is_global:
            self.advertise = False
        super().save(*args, **kwargs)

    # ── Visibility helpers ──────────────────────────────────────────
    @classmethod
    def visible_to(cls, user):
        """
        Return the queryset of active venues this user is allowed to see
        on their event-create form.

          - Anonymous / unauthenticated: nothing.
          - Authenticated (ANY PLAN — free, individual, team, corporate):
            every active global venue. This is the change from the
            earlier corporate-only behaviour: superuser-curated venues
            are now a public registry across all plans.
          - Authenticated corporate members: additionally see venues
            scoped to corporate orgs they're an active member of.
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

        # Globals are unconditional for any authenticated user. Org
        # venues come in only if the user is a member of that corp org.
        return cls.objects.filter(is_active=True).filter(
            models.Q(is_global=True) | models.Q(organization_id__in=org_ids)
        )

    @classmethod
    def advertised(cls):
        """
        Queryset of venues to show on the public homepage as
        advertisements. Restricted to active, global, advertise=True
        rows so we never accidentally promote an org-scoped venue.
        Ordered by `advertise_order` then `name` for a stable layout.
        """
        return (
            cls.objects
            .filter(is_active=True, is_global=True, advertise=True)
            .order_by("advertise_order", "name")
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

    def can_advertise(self, user):
        """
        Only superusers can flip the `advertise` flag, and only on
        global venues. The form layer uses this to decide whether to
        render the advertisement fieldset at all.
        """
        return (
            getattr(user, "is_authenticated", False)
            and user.is_superuser
            and self.is_global
        )

    # ── Display helpers used by the public ad page / homepage ──
    def display_tagline(self):
        """The tagline if set, otherwise the address (or empty)."""
        return self.tagline or self.address or ""

    def get_ad_url(self):
        """Public URL for the venue advertisement detail page."""
        from django.urls import reverse
        return reverse("attendance:venue_ad", kwargs={"pk": self.pk})