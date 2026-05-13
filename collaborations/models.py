import secrets
from datetime import timedelta

from django.conf import settings
from django.db import models
from django.urls import reverse
from django.utils import timezone


# How long a pending invite stays valid.
INVITE_TTL = timedelta(days=7)


def _default_expires_at():
    return timezone.now() + INVITE_TTL


class CollaborationInvite(models.Model):
    """Invite someone to collaborate on a menti (Questionnaire) or a game (Quiz)."""

    KIND_MENTI = "menti"
    KIND_GAME = "game"
    KIND_CHOICES = [(KIND_MENTI, "Menti"), (KIND_GAME, "Game")]

    STATUS_PENDING = "pending"
    STATUS_ACCEPTED = "accepted"
    STATUS_DECLINED = "declined"
    STATUS_EXPIRED = "expired"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_ACCEPTED, "Accepted"),
        (STATUS_DECLINED, "Declined"),
        (STATUS_EXPIRED, "Expired"),
    ]

    PERM_EDIT = "edit"
    PERM_VIEW = "view"
    PERM_CHOICES = [(PERM_EDIT, "Can edit"), (PERM_VIEW, "Can view")]

    inviter = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="invites_sent",
    )
    invitee_email = models.EmailField()
    invitee_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="invites_received",
    )

    kind = models.CharField(max_length=10, choices=KIND_CHOICES)
    target_id = models.PositiveIntegerField(
        help_text="PK of the Questionnaire or Quiz being shared.",
    )
    permission = models.CharField(max_length=10, choices=PERM_CHOICES, default=PERM_EDIT)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING)
    token = models.CharField(max_length=64, unique=True, default=secrets.token_urlsafe)
    message = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True, default=_default_expires_at)

    class Meta:
        constraints = [
            # Only one *pending* invite per (target, email) pair. Accepted/declined/
            # expired invites don't block re-invitation.
            models.UniqueConstraint(
                fields=["kind", "target_id", "invitee_email"],
                condition=models.Q(status="pending"),
                name="uniq_pending_invite_per_target_email",
            ),
        ]
        indexes = [
            models.Index(fields=["status", "expires_at"]),
        ]

    def save(self, *args, **kwargs):
        # Normalize so the unique constraint above is reliable.
        if self.invitee_email:
            self.invitee_email = self.invitee_email.strip().lower()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.inviter} → {self.invitee_email} ({self.kind} #{self.target_id})"

    def is_expired(self):
        """True if a pending invite has aged out. NULL expires_at = legacy, never expires."""
        return bool(self.expires_at and timezone.now() >= self.expires_at)

    def get_target(self):
        if self.kind == self.KIND_MENTI:
            from polls.models import Questionnaire
            return Questionnaire.objects.filter(pk=self.target_id).first()
        from games.models import Quiz
        return Quiz.objects.filter(pk=self.target_id).first()

    def get_accept_url(self):
        return reverse("collaborations:accept", kwargs={"token": self.token})

    def accept(self, user):
        self.invitee_user = user
        self.status = self.STATUS_ACCEPTED
        self.accepted_at = timezone.now()
        self.save()

    def mark_expired(self):
        self.status = self.STATUS_EXPIRED
        self.save(update_fields=["status"])

    def mark_declined(self):
        self.status = self.STATUS_DECLINED
        self.save(update_fields=["status"])


class Collaborator(models.Model):
    """Active collaborator on a specific menti or game. Created on invite accept."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                             related_name="kk_collaborations")
    kind = models.CharField(max_length=10, choices=CollaborationInvite.KIND_CHOICES)
    target_id = models.PositiveIntegerField()
    permission = models.CharField(
        max_length=10,
        choices=CollaborationInvite.PERM_CHOICES,
        default=CollaborationInvite.PERM_EDIT,
    )
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("user", "kind", "target_id")]