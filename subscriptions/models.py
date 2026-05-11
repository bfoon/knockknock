from django.conf import settings
from django.db import models
from django.utils import timezone


class Plan(models.Model):
    """A subscription plan. Seeded via migration / management command."""

    TIER_FREE = "free"
    TIER_INDIVIDUAL = "individual"
    TIER_TEAM = "team"
    TIER_CORPORATE = "corporate"
    TIER_CHOICES = [
        (TIER_FREE, "Free"),
        (TIER_INDIVIDUAL, "Individual"),
        (TIER_TEAM, "Team"),
        (TIER_CORPORATE, "Corporate"),
    ]

    tier = models.CharField(max_length=20, choices=TIER_CHOICES, unique=True)
    name = models.CharField(max_length=80)
    price_monthly = models.DecimalField(max_digits=7, decimal_places=2, default=0)
    item_limit = models.PositiveIntegerField(
        default=0,
        help_text="Max combined mentis + games. 0 = unlimited.",
    )
    fair_use_soft_cap = models.PositiveIntegerField(
        default=0,
        help_text="Soft cap for 'unlimited but fair-use' plans. 0 = no soft cap.",
    )
    max_members = models.PositiveIntegerField(
        default=1,
        help_text="Max workspace members. For corporate, set to a very large number.",
    )
    support_level = models.CharField(max_length=30, default="community")
    description = models.TextField(blank=True)
    is_workspace_plan = models.BooleanField(
        default=False,
        help_text="True for team/corporate (group billing).",
    )

    def __str__(self):
        return self.name

    @property
    def is_unlimited(self):
        return self.item_limit == 0


class Subscription(models.Model):
    """
    Holds the active plan for a billing target.

    Exactly one of (user, organization) is set:
      - user        → for free + individual plans
      - organization → for team + corporate plans
    """

    STATUS_ACTIVE = "active"
    STATUS_TRIAL = "trial"
    STATUS_PAST_DUE = "past_due"
    STATUS_CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_TRIAL, "Trial"),
        (STATUS_PAST_DUE, "Past due"),
        (STATUS_CANCELLED, "Cancelled"),
    ]

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="kk_subscription",
        null=True, blank=True,
    )
    organization = models.OneToOneField(
        "organizations.Organization",
        on_delete=models.CASCADE,
        related_name="subscription",
        null=True, blank=True,
    )
    plan = models.ForeignKey(Plan, on_delete=models.PROTECT, related_name="subscriptions")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_ACTIVE)
    started_at = models.DateTimeField(default=timezone.now)
    renews_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                check=(
                    models.Q(user__isnull=False, organization__isnull=True)
                    | models.Q(user__isnull=True, organization__isnull=False)
                ),
                name="subscription_exactly_one_target",
            ),
        ]

    def __str__(self):
        target = self.user or self.organization
        return f"{target} → {self.plan.name}"


class MockPayment(models.Model):
    """Fake payment record. In production this would be a Stripe charge."""

    subscription = models.ForeignKey(
        Subscription, on_delete=models.CASCADE, related_name="payments"
    )
    amount = models.DecimalField(max_digits=8, decimal_places=2)
    card_last4 = models.CharField(max_length=4)
    cardholder_name = models.CharField(max_length=120)
    succeeded = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"${self.amount} on •••• {self.card_last4}"
