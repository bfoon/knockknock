from django.conf import settings
from django.db import models


class Organization(models.Model):
    """A team or corporate workspace. Owns its own Subscription."""

    KIND_TEAM = "team"
    KIND_CORPORATE = "corporate"
    KIND_CHOICES = [
        (KIND_TEAM, "Team"),
        (KIND_CORPORATE, "Corporate"),
    ]

    name = models.CharField(max_length=120)
    kind = models.CharField(max_length=20, choices=KIND_CHOICES)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="owned_organizations",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name

    @property
    def member_count(self):
        return self.memberships.filter(status=Membership.STATUS_ACTIVE).count()

    @property
    def seat_limit(self):
        sub = getattr(self, "subscription", None)
        return sub.plan.max_members if sub else 0

    def has_open_seat(self):
        return self.member_count < self.seat_limit


class Membership(models.Model):
    """A user's membership in an organization, with role-based permissions."""

    ROLE_ADMIN = "admin"
    ROLE_EDITOR = "editor"
    ROLE_VIEWER = "viewer"
    ROLE_BILLING = "billing"
    ROLE_CHOICES = [
        (ROLE_ADMIN, "Admin"),
        (ROLE_EDITOR, "Editor"),
        (ROLE_VIEWER, "Viewer"),
        (ROLE_BILLING, "Billing"),
    ]

    STATUS_ACTIVE = "active"
    STATUS_INVITED = "invited"
    STATUS_REMOVED = "removed"
    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_INVITED, "Invited"),
        (STATUS_REMOVED, "Removed"),
    ]

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="memberships"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="kk_memberships",
        null=True, blank=True,  # null while invite is pending (no account yet)
    )
    invited_email = models.EmailField(blank=True)
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default=ROLE_EDITOR)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_INVITED)
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "user"],
                condition=models.Q(user__isnull=False),
                name="unique_org_user_membership",
            ),
        ]

    def __str__(self):
        who = self.user.username if self.user else self.invited_email
        return f"{who} @ {self.organization} ({self.role})"

    # ── Permission helpers ────────────────────────────
    def can_invite(self):
        return self.role == self.ROLE_ADMIN

    def can_edit_content(self):
        return self.role in (self.ROLE_ADMIN, self.ROLE_EDITOR)

    def can_manage_billing(self):
        return self.role in (self.ROLE_ADMIN, self.ROLE_BILLING)

    def can_change_roles(self):
        return self.role == self.ROLE_ADMIN


def active_membership(user):
    """Convenience: the user's first active membership, if any.

    Wired onto the User model in apps.py via add_to_class.
    """
    if not getattr(user, "is_authenticated", False):
        return None
    return Membership.objects.filter(
        user=user, status=Membership.STATUS_ACTIVE
    ).select_related("organization").first()
