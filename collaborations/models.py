import secrets

from django.conf import settings
from django.db import models
from django.urls import reverse
from django.utils import timezone


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

    def __str__(self):
        return f"{self.inviter} → {self.invitee_email} ({self.kind} #{self.target_id})"

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
