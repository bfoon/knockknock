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

Review links (view-only sharing):
  • deck_review(token)          — PUBLIC read-only deck viewer
  • deck_request_access(token)  — reviewer asks the owner for edit rights
  • deck_review_settings(code)  — owner: switch on/off, rotate, set a deadline
  • deck_access_decide(code,pk) — owner: approve or decline one request

The editor and present screens are server-rendered shells; all the live
behaviour (reactions, slide sync) runs through consumers.PresentConsumer.
The deck content itself is plain HTTP: the editor loads JSON, edits in the
browser, and POSTs the whole deck back to deck_save.
"""

import json
import os
import uuid
from urllib.parse import quote

from django.conf import settings
from django.contrib import messages
from django.contrib.auth import get_user_model
from django.contrib.auth.decorators import login_required
from django.core.mail import send_mail
from django.core.files.storage import default_storage
from django.core.validators import validate_email
from django.core.exceptions import ValidationError, RequestDataTooBig
from django.db.models import Q
from django.http import JsonResponse, HttpResponseBadRequest, HttpResponseForbidden, Http404
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.views.decorators.http import require_POST
from django.utils import timezone

from .models import (
    Deck, Slide, DeckCollaborator, DeckInvite, DeckReaction, DeckAccessRequest,
)
from .onboarding import ensure_hanns_starter_deck
from .powerpoint_importer import import_powerpoint_into_deck
from .powerpoint_exporter import export_deck_to_pptx, export_filename
from .html_exporter import export_deck_to_html, html_export_filename


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


# ── review links ─────────────────────────────────────────────────────
# Durations the owner can pick from the editor. Held server-side so a
# hand-edited request cannot set itself a ten-year link.
REVIEW_EXPIRY_CHOICES = {
    "24h": 24,
    "7d": 24 * 7,
    "30d": 24 * 30,
    "never": None,
}


def _review_url(request, deck):
    """Absolute view-only link. Token only — never the deck code."""
    return request.build_absolute_uri(
        reverse("hanns:review", args=[str(deck.review_token)])
    )


def _review_deck_or_404(token):
    """Resolve a deck from a review token, or 404.

    Deliberately returns the SAME 404 for a wrong token, a switched-off
    link, an expired one and a deck that never existed, so a stale link
    cannot be used to probe what is here.
    """
    deck = Deck.objects.filter(review_token=token).first()
    if deck is None or not deck.review_link_active():
        raise Http404("This review link is no longer valid.")
    return deck


def _is_presenter_only_element(el):
    """Elements a reviewer must never receive — they are the speaker's crib."""
    if not isinstance(el, dict):
        return True
    return el.get("type") == "object" and el.get("objectType") == "teleprompter"


def _review_payload(deck):
    """deck.as_dict() cut down to what a reviewer is allowed to see.

    Dropped: the join code (which would unlock the audience phone page and
    the presenter controller), the live state, speaker notes and
    teleprompter elements. This happens server-side, so nothing private is
    ever sent to the browser for someone to find in devtools.
    """
    data = deck.as_dict()
    for key in ("code", "state", "current_slide", "allow_reactions", "allow_download"):
        data.pop(key, None)

    slides = []
    for raw in data.get("slides", []):
        slide = dict(raw)
        slide.pop("notes", None)
        els = slide.get("els")
        slide["els"] = [
            el for el in (els if isinstance(els, list) else [])
            if not _is_presenter_only_element(el)
        ]
        slides.append(slide)
    data["slides"] = slides
    return data


def _expiry_label(deck):
    """One line of plain English about the state of the review link."""
    if not deck.allow_review:
        return "Off — the link does not open."
    if not deck.review_expires_at:
        return "On — open until you switch it off."
    if deck.review_expired:
        return "Closed — the deadline passed."
    when = timezone.localtime(deck.review_expires_at).strftime("%d %b %Y, %H:%M")
    return f"On — closes {when}."


def _deck_owner_label(deck):
    owner = deck.owner
    if not owner:
        return "Knock-Knock"
    full = ""
    if hasattr(owner, "get_full_name"):
        full = (owner.get_full_name() or "").strip()
    return full or owner.get_username()


def _person_label(user):
    full = ""
    if hasattr(user, "get_full_name"):
        full = (user.get_full_name() or "").strip()
    return full or user.get_username()


def _login_url():
    try:
        return reverse("accounts:login")
    except Exception:
        return str(getattr(settings, "LOGIN_URL", "/accounts/login/"))


def _signup_url():
    try:
        return reverse("accounts:signup_individual")
    except Exception:
        return _login_url()


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


def _send_access_request_email(*, request, deck, access_request):
    """Tell the owner that someone is asking to edit."""
    owner_email = getattr(deck.owner, "email", "") or ""
    if not owner_email:
        return
    asker = _person_label(access_request.user)
    link = request.build_absolute_uri(reverse("hanns:edit", args=[deck.code]))
    note = f"\n\nThey wrote:\n{access_request.message}\n" if access_request.message else "\n"
    send_mail(
        f"{asker} wants to edit “{deck.title}”",
        (
            f"Hello {_deck_owner_label(deck)},\n\n"
            f"{asker} ({access_request.user.email}) reviewed “{deck.title}” "
            f"and is asking for editing rights.{note}\n"
            f"Approve or decline from the deck's Options menu:\n{link}\n\n"
            f"Thank you."
        ),
        getattr(settings, "DEFAULT_FROM_EMAIL", None) or "no-reply@knockknock.local",
        [owner_email],
        fail_silently=True,
    )


def _send_access_decision_email(*, request, deck, access_request, approved):
    """Tell the reviewer what the owner decided."""
    to = getattr(access_request.user, "email", "") or ""
    if not to:
        return
    if approved:
        link = request.build_absolute_uri(reverse("hanns:edit", args=[deck.code]))
        subject = f"You can now edit “{deck.title}”"
        body = (
            f"Hello,\n\n"
            f"Your request to edit the Hanns presentation “{deck.title}” was approved.\n\n"
            f"Open the editor here:\n{link}\n\n"
            f"Thank you."
        )
    else:
        subject = f"About your request to edit “{deck.title}”"
        body = (
            f"Hello,\n\n"
            f"Your request to edit the Hanns presentation “{deck.title}” was "
            f"declined. You can still open the review link to read the deck.\n\n"
            f"Thank you."
        )
    send_mail(
        subject, body,
        getattr(settings, "DEFAULT_FROM_EMAIL", None) or "no-reply@knockknock.local",
        [to], fail_silently=True,
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
    download_url = ""
    if deck.allow_download:
        download_url = request.build_absolute_uri(
            reverse("hanns:audience_download", kwargs={
                "code": deck.code, "token": str(deck.download_token),
            })
        )
    is_owner = deck.owner_id == request.user.id
    review_url = _review_url(request, deck) if deck.review_link_active() else ""
    return render(request, "hanns/editor.html", {
        "deck": deck,
        "deck_json": json.dumps(deck.as_dict()),
        "present_url": request.build_absolute_uri(
            reverse("hanns:present", args=[deck.code])),
        "is_deck_owner": is_owner,
        "collaborators": deck.deck_collaborators.select_related("user").all(),
        "pending_invites": deck.deck_invites.filter(status=DeckInvite.STATUS_PENDING),
        "download_url": download_url,
        "review_url": review_url,
        "review_state_label": _expiry_label(deck),
        # Only the owner answers requests, so only the owner is handed them.
        "access_requests": (
            deck.access_requests.select_related("user").filter(
                status=DeckAccessRequest.STATUS_PENDING)
            if is_owner else []
        ),
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
def deck_powerpoint_import(request, code):
    """
    Import a PowerPoint file into the current Hanns deck.

    The importer converts PPT/PPTX slides into Hanns JSON slides so the user
    can keep editing text, images, shapes and animations inside the editor.
    Uploaded media is stored as normal media files; the slide JSON stores only
    URLs so autosave remains small.
    """
    deck, denied = _editable_deck_or_403(request, code)
    if denied:
        return denied

    upload = request.FILES.get("powerpoint") or request.FILES.get("file") or request.FILES.get("ppt")
    if not upload:
        return JsonResponse({"ok": False, "error": "No PowerPoint file was uploaded."}, status=400)

    try:
        result = import_powerpoint_into_deck(request=request, deck=deck, uploaded_file=upload, replace=True)
    except Exception as exc:
        return JsonResponse({
            "ok": False,
            "error": str(exc) or "PowerPoint import failed.",
        }, status=400)

    return JsonResponse({
        "ok": True,
        "deck": deck.as_dict(),
        "slide_count": deck.slides.count(),
        "warnings": result.get("warnings", []),
    })


@login_required
@require_POST
def deck_import_powerpoint_new(request):
    """Create a brand-new Hanns deck directly from an uploaded PPT/PPTX file."""
    upload = request.FILES.get("powerpoint") or request.FILES.get("file") or request.FILES.get("ppt")
    if not upload:
        messages.error(request, "Please choose a PowerPoint file to import.")
        return redirect("hanns:list")

    deck = Deck.objects.create(owner=request.user, title="Imported PowerPoint", state="draft")
    try:
        import_powerpoint_into_deck(request=request, deck=deck, uploaded_file=upload, replace=True)
    except Exception as exc:
        deck.delete()
        messages.error(request, str(exc) or "PowerPoint import failed.")
        return redirect("hanns:list")

    messages.success(request, "PowerPoint imported into Hanns.")
    return redirect("hanns:edit", code=deck.code)


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
        # Fresh presentation run: clear previous emoji totals so the small
        # presenter counter starts at zero for this live session. The actual
        # new reactions will be recorded again by the WebSocket consumer.
        DeckReaction.objects.filter(deck=deck).delete()
        deck.state = "live"
        deck.save(update_fields=["state"])
    download_url = ""
    if deck.allow_download:
        download_url = request.build_absolute_uri(
            reverse("hanns:audience_download", kwargs={
                "code": deck.code, "token": str(deck.download_token),
            })
        )
    return render(request, "hanns/present.html", {
        "deck": deck,
        "deck_json": json.dumps(deck.as_dict()),
        "join_url": _join_url(request, deck),
        "control_url": _control_url(request, deck),
        "control_pin": _control_pin(deck),
        "download_url": download_url,
    })


@login_required
def deck_export_powerpoint(request, code):
    """Download the deck as a .pptx file.

    Exports every slide and element (text, images, shapes, lines, charts) plus
    speaker notes. Available to the owner and edit-collaborators.
    """
    deck = get_object_or_404(Deck, code=code.upper())
    if not _can_edit_deck(request.user, deck):
        return HttpResponseForbidden("You do not have access to export this deck.")

    try:
        buf = export_deck_to_pptx(deck)
    except ValueError as exc:
        return HttpResponseBadRequest(str(exc))

    from django.http import FileResponse
    response = FileResponse(
        buf,
        as_attachment=True,
        filename=export_filename(deck),
        content_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
    )
    return response


@login_required
def deck_export_html(request, code):
    """Download the deck as a single self-contained .html file.

    The exported file bundles the real Hanns renderer (hanns_core.js +
    hanns.css), so it looks identical to the editor/stage and plays offline in
    any browser. Available to the owner and edit-collaborators.
    """
    deck = get_object_or_404(Deck, code=code.upper())
    if not _can_edit_deck(request.user, deck):
        return HttpResponseForbidden("You do not have access to export this deck.")
    return _deck_html_response(deck)


def _deck_html_response(deck):
    """Build the standalone .html download for ``deck``.

    Shared by the owner export and the public token download so both always
    produce byte-identical files.
    """
    from django.contrib.staticfiles import finders

    def _read_static(rel):
        path = finders.find(rel)
        if not path:
            return ""
        try:
            with open(path, "r", encoding="utf-8") as fh:
                return fh.read()
        except OSError:
            return ""

    css = _read_static("hanns/css/hanns.css")
    rich_css = _read_static("hanns/css/hanns_rich_data.css")
    core_js = _read_static("hanns/js/hanns_core.js")
    # Actors must travel with the deck or every character in it degrades to
    # a count grid in the downloaded file.
    actors_js = _read_static("hanns/js/hanns_actors.js")
    # These two wrap core rather than preceding it, so they are inlined
    # after it. Same order as editor.html / present.html.
    studio_js = _read_static("hanns/js/hanns_studio.js")
    fluid_js = _read_static("hanns/js/hanns_fluid.js")

    if not core_js:
        return HttpResponseBadRequest(
            "Could not locate hanns_core.js in static files. Run collectstatic "
            "or check STATICFILES settings."
        )

    css_combined = (css or "") + "\n\n" + (rich_css or "")
    html = export_deck_to_html(
        deck, css_text=css_combined, core_js_text=core_js,
        actors_js_text=actors_js,
        post_core_js_text="\n".join(p for p in (studio_js, fluid_js) if p),
    )

    from django.http import HttpResponse
    response = HttpResponse(html, content_type="text/html; charset=utf-8")
    response["Content-Disposition"] = (
        f'attachment; filename="{html_export_filename(deck)}"'
    )
    return response


def _audience_deck_or_404(code, token):
    """Resolve a deck from a public download link, or 404.

    Deliberately returns the SAME 404 for a wrong token, a disabled deck and
    a missing deck, so the link cannot be used to probe which codes exist.
    """
    deck = get_object_or_404(Deck, code=code.upper())
    if not getattr(deck, "allow_download", False):
        raise Http404("Downloads are not enabled for this deck.")
    if str(deck.download_token) != str(token):
        raise Http404("This download link is no longer valid.")
    return deck


def deck_audience_download(request, code, token):
    """PUBLIC landing page reached by scanning the end-of-show QR.

    Shows what the file is and who it is from, then offers the download —
    rather than firing a file at a phone that just scanned a code. No login:
    the token IS the credential.
    """
    deck = _audience_deck_or_404(code, token)
    if request.GET.get("download") == "1":
        return _deck_html_response(deck)
    return render(request, "hanns/audience_download.html", {
        "deck": deck,
        "download_url": (
            reverse("hanns:audience_download",
                    kwargs={"code": deck.code, "token": token}) + "?download=1"
        ),
        "slide_count": deck.slides.count(),
    })


@login_required
@require_POST
def deck_download_settings(request, code):
    """Owner toggles audience downloads / rotates the share token."""
    deck = get_object_or_404(Deck, code=code.upper(), owner=request.user)

    if request.POST.get("rotate") == "1":
        deck.rotate_download_token()
    else:
        deck.allow_download = request.POST.get("allow_download") in ("1", "true", "on")
        deck.save(update_fields=["allow_download"])

    url = ""
    if deck.allow_download:
        url = request.build_absolute_uri(
            reverse("hanns:audience_download", kwargs={
                "code": deck.code, "token": str(deck.download_token),
            })
        )
    return JsonResponse({
        "ok": True,
        "allow_download": deck.allow_download,
        "download_url": url,
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
        if state == "live" and deck.state != "live":
            DeckReaction.objects.filter(deck=deck).delete()
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


# ── review links ─────────────────────────────────────────────────────
def deck_review(request, token):
    """PUBLIC read-only deck viewer. The token is the credential.

    No login is needed to read. Read-only is enforced by what is served
    rather than by the interface: the page receives a stripped payload and
    none of the editor JavaScript, so there is nothing here that could
    write back even if it tried.
    """
    deck = _review_deck_or_404(token)

    user = request.user
    signed_in = bool(getattr(user, "is_authenticated", False))
    can_edit = _can_edit_deck(user, deck)

    my_request = None
    if signed_in and not can_edit:
        my_request = DeckAccessRequest.objects.filter(deck=deck, user=user).first()

    review_path = reverse("hanns:review", args=[str(deck.review_token)])
    bounce = quote(review_path + "?ask=1")

    return render(request, "hanns/review.html", {
        "deck": deck,
        "deck_json": json.dumps(_review_payload(deck)),
        "slide_count": deck.slides.count(),
        "owner_label": _deck_owner_label(deck),
        "expires_at": deck.review_expires_at,
        "signed_in": signed_in,
        "can_edit": can_edit,
        "is_owner": signed_in and deck.owner_id == user.id,
        "access_request": my_request,
        "request_access_url": reverse(
            "hanns:request_access", args=[str(deck.review_token)]),
        "edit_url": reverse("hanns:edit", args=[deck.code]) if can_edit else "",
        "login_url": f"{_login_url()}?next={bounce}",
        "signup_url": f"{_signup_url()}?next={bounce}",
        # ?ask=1 comes back from the login/signup bounce — reopen the form
        # so nobody has to find their place again.
        "open_ask": request.GET.get("ask") == "1",
    })


def deck_request_access(request, token):
    """A reviewer asks the owner for contributor rights.

    Signed out, they go through login (or signup) and land back on the same
    review page with the form open. Signed in, the request reaches the
    owner by email and in the editor.
    """
    deck = _review_deck_or_404(token)
    review_path = reverse("hanns:review", args=[str(deck.review_token)])

    if not getattr(request.user, "is_authenticated", False):
        # Mirrors deck_accept_invite: a signup flow that drops ?next can
        # read this back after the account exists and finish the journey.
        request.session["pending_hanns_review_token"] = str(deck.review_token)
        request.session.setdefault("pending_plan_tier", "free")
        messages.info(request, "Sign in to Knock-Knock to ask for editing rights.")
        bounce = quote(review_path + "?ask=1")
        return redirect(f"{_login_url()}?next={bounce}")

    if request.method != "POST":
        return redirect(f"{review_path}?ask=1")

    if _can_edit_deck(request.user, deck):
        messages.info(request, "You already have editing rights on this deck.")
        return redirect("hanns:edit", code=deck.code)

    note = (request.POST.get("message") or "").strip()[:500]
    req, created = DeckAccessRequest.objects.get_or_create(
        deck=deck, user=request.user, defaults={"message": note},
    )
    if not created:
        if req.status == DeckAccessRequest.STATUS_APPROVED:
            messages.info(request, "You already have editing rights on this deck.")
            return redirect("hanns:edit", code=deck.code)
        if req.is_pending:
            messages.info(
                request,
                f"{_deck_owner_label(deck)} already has your request. "
                f"You will get an email when they answer.",
            )
            return redirect(review_path)
        # Declined before — same row, asked again.
        req.reopen(message=note)

    _send_access_request_email(request=request, deck=deck, access_request=req)
    messages.success(
        request,
        f"Your request went to {_deck_owner_label(deck)}. "
        f"You will get an email when they answer.",
    )
    return redirect(review_path)


@login_required
@require_POST
def deck_review_settings(request, code):
    """Owner switches the review link on/off, rotates it, or sets a deadline."""
    deck = get_object_or_404(Deck, code=code.upper(), owner=request.user)

    if request.POST.get("rotate") == "1":
        deck.rotate_review_token()

    elif "expires_in" in request.POST:
        key = request.POST.get("expires_in")
        if key not in REVIEW_EXPIRY_CHOICES:
            return JsonResponse(
                {"ok": False, "error": "Pick one of the offered durations."},
                status=400,
            )
        hours = REVIEW_EXPIRY_CHOICES[key]
        deck.review_expires_at = (
            None if hours is None
            else timezone.now() + timezone.timedelta(hours=hours)
        )
        deck.save(update_fields=["review_expires_at"])

    else:
        on = request.POST.get("allow_review") in ("1", "true", "on")
        was_expired = deck.review_expired
        deck.allow_review = on
        if on and was_expired:
            # Switching back on after the deadline passed should reopen the
            # link, not hand back one that 404s.
            deck.review_expires_at = None
            deck.save(update_fields=["allow_review", "review_expires_at"])
        else:
            deck.save(update_fields=["allow_review"])

    return JsonResponse({
        "ok": True,
        "allow_review": deck.allow_review,
        "review_url": _review_url(request, deck) if deck.review_link_active() else "",
        "expires_at": (
            deck.review_expires_at.isoformat() if deck.review_expires_at else ""
        ),
        "expires_label": _expiry_label(deck),
    })


@login_required
@require_POST
def deck_access_decide(request, code, pk):
    """Owner approves or declines one contributor request."""
    deck = get_object_or_404(Deck, code=code.upper(), owner=request.user)
    req = get_object_or_404(DeckAccessRequest, pk=pk, deck=deck)

    action = (request.POST.get("action") or "").lower()
    if action == "approve":
        req.approve(by_user=request.user)
    elif action in ("decline", "deny"):
        req.decline(by_user=request.user)
    else:
        return JsonResponse({"ok": False, "error": "Unknown action."}, status=400)

    _send_access_decision_email(
        request=request, deck=deck, access_request=req,
        approved=(req.status == DeckAccessRequest.STATUS_APPROVED),
    )
    return JsonResponse({
        "ok": True,
        "id": req.pk,
        "status": req.status,
        "person": _person_label(req.user),
        "pending": deck.access_requests.filter(
            status=DeckAccessRequest.STATUS_PENDING).count(),
    })
