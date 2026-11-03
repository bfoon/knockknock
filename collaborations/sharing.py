"""
Direct sharing: give someone with a Knock-Knock account access to a game
or a Wenti right away, change what they can do, or take it back.

Two tables are kept in step, as the invite-accept path already does
(invite_signup._grant_access):
  • collaborations.Collaborator — the generic row; games read it
    (games.models.Quiz.access_for).
  • polls.QuestionnaireCollaborator — what Wenti's permission checks read.

Permissions: "view" (open it, see results) or "edit" (also change it,
start it, and present it for the owner).
"""

from django.contrib.auth import get_user_model
from django.db import transaction
from django.template.loader import render_to_string
from django.urls import reverse

from .models import Collaborator, CollaborationInvite
from .services import _absolute, _safe_send

PERMISSIONS = ("view", "edit")


def _is_menti(kind):
    return kind == CollaborationInvite.KIND_MENTI


def people_with_access(kind, target):
    """[{user, permission}] — everyone the owner shared it with, oldest first."""
    if _is_menti(kind):
        from polls.models import QuestionnaireCollaborator
        rows = (QuestionnaireCollaborator.objects.filter(questionnaire=target)
                .select_related("user").order_by("created_at"))
        return [{"user": r.user, "permission": "edit" if r.role in ("edit", "owner") else "view"} for r in rows]
    rows = (Collaborator.objects.filter(kind=kind, target_id=target.pk)
            .select_related("user").order_by("added_at"))
    return [{"user": r.user, "permission": r.permission} for r in rows]


@transaction.atomic
def grant(kind, target, user, permission, by):
    """Give `user` access (or change it). Returns True if they're new."""
    _, created = Collaborator.objects.update_or_create(
        user=user, kind=kind, target_id=target.pk,
        defaults={"permission": permission},
    )
    if _is_menti(kind):
        from polls.models import QuestionnaireCollaborator
        _, created_app = QuestionnaireCollaborator.objects.update_or_create(
            questionnaire=target, user=user,
            defaults={"role": permission, "invited_by": by},
        )
        created = created or created_app
    return created


@transaction.atomic
def remove(kind, target, user):
    Collaborator.objects.filter(user=user, kind=kind, target_id=target.pk).delete()
    if _is_menti(kind):
        from polls.models import QuestionnaireCollaborator
        QuestionnaireCollaborator.objects.filter(questionnaire=target, user=user).delete()


def account_for_email(email):
    return get_user_model().objects.filter(email__iexact=(email or "").strip()).first()


def target_url(kind, target):
    return reverse("polls:edit", args=[target.pk]) if _is_menti(kind) else reverse("games:edit", args=[target.pk])


def notify_shared(kind, target, user, permission, by, message="", request=None):
    """Tell someone they've been given access (no accept step needed)."""
    if not user.email:
        return
    body = render_to_string("emails/shared_with_you.txt", {
        "user": user, "by": by, "target": target, "permission": permission,
        "what": "Wenti" if _is_menti(kind) else "game",
        "message": message,
        "url": _absolute(request, target_url(kind, target)),
    })
    _safe_send(f"{by.username} shared “{target.title}” with you on Knock-Knock",
               body, user.email, context_label="shared-with-you email")
