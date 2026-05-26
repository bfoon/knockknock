"""
hanns/views.py — HTTP views for the Hanns presentation studio.

Roles:
  • deck_list()            — the owner's saved decks
  • deck_create()          — make a new deck, jump into the editor
  • deck_edit(code)        — the editor shell (loads the deck as JSON)
  • deck_save(code)        — POST {title, slides:[…]} → persist (AJAX)
  • deck_present(code)     — presenter / projector stage (runs animations)
  • deck_join(code)        — audience phone (the QR target): tap reactions
  • deck_set_state(code)   — POST {state} → live | ended
  • deck_delete(code)      — delete a deck (owner, POST only)

The editor and present screens are server-rendered shells; all the live
behaviour (reactions, slide sync) runs through consumers.PresentConsumer.
The deck content itself is plain HTTP: the editor loads JSON, edits in the
browser, and POSTs the whole deck back to deck_save.
"""

import json
import os
import uuid

from django.conf import settings
from django.contrib import messages
from django.contrib.auth import get_user_model
from django.contrib.auth.decorators import login_required
from django.core.mail import send_mail
from django.core.files.storage import default_storage
from django.core.validators import validate_email
from django.core.exceptions import ValidationError, RequestDataTooBig
from django.db.models import Q
from django.http import JsonResponse, HttpResponseBadRequest, HttpResponseForbidden
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.views.decorators.http import require_POST
from django.utils import timezone

from .models import Deck, Slide, DeckCollaborator, DeckInvite
from .onboarding import ensure_hanns_starter_deck


def _join_url(request, deck):
    """Absolute URL a phone hits when it scans the QR code on the stage."""
    return request.build_absolute_uri(reverse("hanns:join", args=[deck.code]))


def _control_pin(deck):
    """Deterministic 4-digit presenter-controller PIN. No migration needed."""
    total = sum((i + 1) * ord(ch) for i, ch in enumerate(deck.code or "HANNS"))
    return str(1000 + (total % 9000))


def _control_url(request, deck):
    return request.build_absolute_uri(reverse("hanns:control", args=[deck.code]))


def _can_edit_deck(user, deck):
    """Owner and accepted DeckCollaborator records can edit the deck."""
    if not getattr(user, "is_authenticated", False):
        return False
    if deck.owner_id == user.id:
        return True
    return DeckCollaborator.objects.filter(
        deck=deck, user=user, permission=DeckCollaborator.PERMISSION_EDIT,
    ).exists()


def _editable_deck_or_403(request, code):
    deck = get_object_or_404(Deck, code=code.upper())
    if not _can_edit_deck(request.user, deck):
        return deck, JsonResponse({"ok": False, "error": "You do not have edit access to this deck."}, status=403)
    return deck, None


def _split_emails(raw):
    bits = re_split_emails(raw or "")
    clean = []
    seen = set()
    for email in bits:
        email = email.strip().lower()
        if not email or email in seen:
            continue
        try:
            validate_email(email)
        except ValidationError:
            continue
        seen.add(email)
        clean.append(email)
    return clean


def re_split_emails(raw):
    import re
    return re.split(r"[\s,;]+", raw or "")


def _send_hanns_invite_email(*, request, deck, email, link, has_account):
    subject = f"You’re invited to edit “{deck.title}” on Knock-Knock"
    if has_account:
        body = (
            f"Hello,\n\n"
            f"You have been invited to live-edit the Hanns presentation “{deck.title}”.\n\n"
            f"Open the deck here:\n{link}\n\n"
            f"Thank you."
        )
    else:
        body = (
            f"Hello,\n\n"
            f"You have been invited to join Knock-Knock and live-edit the Hanns presentation “{deck.title}”.\n\n"
            f"Create your free account and accept the invite here:\n{link}\n\n"
            f"Thank you."
        )
    send_mail(
        subject,
        body,
        getattr(settings, "DEFAULT_FROM_EMAIL", None) or "no-reply@knockknock.local",
        [email],
        fail_silently=True,
    )


# ── owner-facing ─────────────────────────────────────────────────────
@login_required
def deck_list(request):
    # First-time Hanns users get a ready-made editable tutorial deck.
    # It uses the same JSON slide format as normal decks, so it can be
    # duplicated, edited, presented, or deleted like any other deck.
    ensure_hanns_starter_deck(request.user)

    decks = Deck.objects.filter(
        Q(owner=request.user) | Q(deck_collaborators__user=request.user)
    ).distinct().order_by("-updated_at")
    # First-slide previews for the dashboard thumbnails, as a {code: slide}
    # JSON map. Built here (not in the template) because a slide's as_dict()
    # must be JSON-encoded, which a template can't do inline.
    firsts = {}
    for d in decks:
        first = d.slides.first()
        firsts[d.code] = first.as_dict() if first else None
    return render(request, "hanns/deck_list.html", {
        "decks": decks,
        "decks_total": decks.count(),
        "firsts_json": json.dumps(firsts),
    })


@login_required
def deck_create(request):
    """Create a deck with one starter slide, then open the editor."""
    deck = Deck.objects.create(
        owner=request.user,
        title=request.POST.get("title", "Untitled deck")[:140] or "Untitled deck",
        state="draft",
    )
    # Seed a single blank slide so the editor never opens empty. The editor
    # immediately offers the template gallery on top of this.
    Slide.objects.create(deck=deck, position=0, data={
        "bg": "#f6f1e7", "bgSize": None, "bgFx": "none", "transition": "fade", "els": [],
    })
    return redirect("hanns:edit", code=deck.code)


@login_required
def deck_edit(request, code):
    """The editor shell. Owner or invited collaborators can edit."""
    deck = get_object_or_404(Deck, code=code.upper())
    if not _can_edit_deck(request.user, deck):
        messages.error(request, "You do not have permission to edit this deck.")
        return redirect("hanns:list")
    return render(request, "hanns/editor.html", {
        "deck": deck,
        "deck_json": json.dumps(deck.as_dict()),
        "present_url": request.build_absolute_uri(
            reverse("hanns:present", args=[deck.code])),
        "is_deck_owner": deck.owner_id == request.user.id,
        "collaborators": deck.deck_collaborators.select_related("user").all(),
        "pending_invites": deck.deck_invites.filter(status=DeckInvite.STATUS_PENDING),
    })


@login_required
@require_POST
def deck_save(request, code):
    """
    Persist the whole deck from the editor (AJAX). Body is JSON:
        {title, allow_reactions, slides:[{bg,bgSize,transition,els:[…]}, …]}
    Replaces the slide rows wholesale — simplest correct approach for a
    single-author editor, and cheap at presentation scale (tens of slides).
    """
    deck, denied = _editable_deck_or_403(request, code)
    if denied:
        return denied
    try:
        payload = json.loads(request.body or "{}")
    except RequestDataTooBig:
        return JsonResponse({
            "ok": False,
            "error": (
                "The deck save request is too large. Images should be uploaded "
                "as media files first, not stored as base64 inside the slide JSON."
            ),
        }, status=413)
    except (ValueError, TypeError):
        return HttpResponseBadRequest("invalid JSON")

    title = (payload.get("title") or "").strip()[:140]
    if title:
        deck.title = title
    if "allow_reactions" in payload:
        deck.allow_reactions = bool(payload.get("allow_reactions"))
    deck.save()

    slides = payload.get("slides")
    if isinstance(slides, list):
        deck.slides.all().delete()
        bulk = []
        for i, s in enumerate(slides):
            if not isinstance(s, dict):
                continue
            bulk.append(Slide(deck=deck, position=i, data={
                "bg": s.get("bg", "#f6f1e7"),
                "bgSize": s.get("bgSize"),
                "bgFx": s.get("bgFx", "none"),
                "transition": s.get("transition", "fade"),
                "notes": s.get("notes", ""),
                "els": s.get("els", []) if isinstance(s.get("els"), list) else [],
            }))
        Slide.objects.bulk_create(bulk)

    return JsonResponse({"ok": True, "saved": deck.slides.count(),
                         "updated_at": deck.updated_at.isoformat()})


@login_required
@require_POST
def deck_image_upload(request, code):
    """
    Store pasted/dropped Hanns slide images as normal media files and return
    a stable URL. This keeps slide JSON small and prevents
    DATA_UPLOAD_MAX_MEMORY_SIZE errors when autosave runs.
    """
    deck, denied = _editable_deck_or_403(request, code)
    if denied:
        return denied

    image = request.FILES.get("image") or request.FILES.get("file")
    if not image:
        return JsonResponse({"ok": False, "error": "No image file was uploaded."}, status=400)

    content_type = (getattr(image, "content_type", "") or "").lower()
    original_name = os.path.basename(getattr(image, "name", "") or "image")
    _, ext = os.path.splitext(original_name)
    ext = (ext or "").lower()

    allowed_exts = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif"}
    if not (content_type.startswith("image/") or ext in allowed_exts):
        return JsonResponse({"ok": False, "error": "Only image files can be uploaded."}, status=400)

    max_size = int(getattr(settings, "HANNS_IMAGE_UPLOAD_MAX_SIZE", 15 * 1024 * 1024))
    if getattr(image, "size", 0) and image.size > max_size:
        return JsonResponse({
            "ok": False,
            "error": f"Image is too large. Maximum allowed size is {max_size // (1024 * 1024)} MB.",
        }, status=413)

    if ext not in allowed_exts:
        # Prefer the browser MIME type when the filename has no usable extension.
        ext = ".jpg" if content_type in {"image/jpeg", "image/jpg"} else ".png"

    rel_path = f"hanns/decks/{deck.code}/images/{uuid.uuid4().hex}{ext}"
    saved_path = default_storage.save(rel_path, image)
    url = default_storage.url(saved_path)
    return JsonResponse({
        "ok": True,
        "url": request.build_absolute_uri(url),
        "path": saved_path,
    })


@login_required
@require_POST
def deck_invite(request, code):
    """Invite one or more people to live-edit this deck."""
    deck = get_object_or_404(Deck, code=code.upper(), owner=request.user)
    try:
        payload = json.loads(request.body or "{}")
    except (ValueError, TypeError):
        payload = request.POST

    raw = payload.get("emails") or payload.get("email") or ""
    emails = _split_emails(raw)
    if not emails:
        return JsonResponse({"ok": False, "error": "Enter at least one valid email address."}, status=400)

    User = get_user_model()
    added, invited, skipped = [], [], []
    edit_url = request.build_absolute_uri(reverse("hanns:edit", args=[deck.code]))

    for email in emails:
        if deck.owner and deck.owner.email and email == deck.owner.email.lower():
            skipped.append({"email": email, "reason": "owner"})
            continue

        user = User.objects.filter(email__iexact=email).first()
        if user:
            DeckCollaborator.objects.update_or_create(
                deck=deck,
                user=user,
                defaults={
                    "permission": DeckCollaborator.PERMISSION_EDIT,
                    "invited_by": request.user,
                    "accepted_at": timezone.now(),
                },
            )
            _send_hanns_invite_email(
                request=request, deck=deck, email=email, link=edit_url, has_account=True,
            )
            added.append({"email": email, "user": user.get_username()})
        else:
            inv = DeckInvite.objects.filter(
                deck=deck, email=email, status=DeckInvite.STATUS_PENDING,
            ).first()
            if not inv:
                inv = DeckInvite.objects.create(
                    deck=deck,
                    email=email,
                    permission=DeckCollaborator.PERMISSION_EDIT,
                    invited_by=request.user,
                )
            signup_link = request.build_absolute_uri(
                reverse("hanns:accept_invite", args=[inv.token])
            )
            _send_hanns_invite_email(
                request=request, deck=deck, email=email, link=signup_link, has_account=False,
            )
            invited.append({"email": email})

    return JsonResponse({
        "ok": True,
        "added": added,
        "invited": invited,
        "skipped": skipped,
        "message": f"{len(added)} account user(s) added, {len(invited)} signup invite(s) sent.",
    })


def deck_accept_invite(request, token):
    """Accept a Hanns invite. Anonymous users are sent to signup first."""
    inv = get_object_or_404(DeckInvite, token=token)
    if inv.status != DeckInvite.STATUS_PENDING:
        messages.info(request, "This invite has already been used or is no longer active.")
        return redirect("hanns:list" if request.user.is_authenticated else "accounts:login")

    if not request.user.is_authenticated:
        request.session["pending_hanns_invite_token"] = str(inv.token)
        request.session.setdefault("pending_plan_tier", "free")
        messages.info(request, "Create your Knock-Knock account to accept the presentation invite.")
        return redirect("accounts:signup_individual")

    user_email = (request.user.email or "").lower()
    if inv.email.lower() != user_email:
        messages.error(request, "This invite was sent to a different email address.")
        return redirect("hanns:list")

    inv.accept(request.user)
    messages.success(request, f"You can now live-edit “{inv.deck.title}”.")
    return redirect("hanns:edit", code=inv.deck.code)


# ── presenting ───────────────────────────────────────────────────────
@login_required
def deck_present(request, code):
    """Presenter / projector stage — runs animations, shows QR, floats emoji."""
    deck = get_object_or_404(Deck, code=code.upper(), owner=request.user)
    # Entering the stage flips the deck live so audience reactions are
    # accepted; deck_set_state(ended) closes it again.
    if deck.state != "live":
        deck.state = "live"
        deck.save(update_fields=["state"])
    return render(request, "hanns/present.html", {
        "deck": deck,
        "deck_json": json.dumps(deck.as_dict()),
        "join_url": _join_url(request, deck),
        "control_url": _control_url(request, deck),
        "control_pin": _control_pin(deck),
    })


def deck_control(request, code):
    """
    Hidden presenter phone controller. Public page, protected by the PIN shown
    only from the presenter screen controller modal.
    """
    deck = get_object_or_404(Deck, code=code.upper())
    return render(request, "hanns/control.html", {
        "deck": deck,
        "deck_json": json.dumps(deck.as_dict()),
        "control_pin": _control_pin(deck),
    })


def deck_join(request, code):
    """
    Audience phone — the URL encoded in the QR code. Public (no login):
    anyone in the room can scan and react. Shows the reaction pad only.
    """
    deck = get_object_or_404(Deck, code=code.upper())
    return render(request, "hanns/join.html", {
        "deck": deck,
    })


@login_required
@require_POST
def deck_set_state(request, code):
    """Flip a deck live ↔ ended (presenter control)."""
    deck = get_object_or_404(Deck, code=code.upper(), owner=request.user)
    state = request.POST.get("state")
    if state in dict(Deck.STATE_CHOICES):
        deck.state = state
        deck.save(update_fields=["state"])
    return JsonResponse({"ok": True, "state": deck.state})


@login_required
@require_POST
def deck_delete(request, code):
    """Delete a deck the current user owns, then return to `next`."""
    deck = get_object_or_404(Deck, code=code.upper(), owner=request.user)
    title = deck.title
    deck.delete()
    messages.success(request, f"Deleted “{title}”.")
    nxt = request.POST.get("next") or request.GET.get("next")
    return redirect(nxt or reverse("hanns:list"))
