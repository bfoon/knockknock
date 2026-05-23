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

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse, HttpResponseBadRequest
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.views.decorators.http import require_POST

from .models import Deck, Slide


def _join_url(request, deck):
    """Absolute URL a phone hits when it scans the QR code on the stage."""
    return request.build_absolute_uri(reverse("hanns:join", args=[deck.code]))


def _control_pin(deck):
    """Deterministic 4-digit presenter-controller PIN. No migration needed."""
    total = sum((i + 1) * ord(ch) for i, ch in enumerate(deck.code or "HANNS"))
    return str(1000 + (total % 9000))


def _control_url(request, deck):
    return request.build_absolute_uri(reverse("hanns:control", args=[deck.code]))


# ── owner-facing ─────────────────────────────────────────────────────
@login_required
def deck_list(request):
    decks = Deck.objects.filter(owner=request.user).order_by("-updated_at")
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
        "bg": "#f6f1e7", "bgSize": None, "transition": "fade", "els": [],
    })
    return redirect("hanns:edit", code=deck.code)


@login_required
def deck_edit(request, code):
    """The editor shell. The deck is serialised into the page as JSON."""
    deck = get_object_or_404(Deck, code=code.upper(), owner=request.user)
    return render(request, "hanns/editor.html", {
        "deck": deck,
        "deck_json": json.dumps(deck.as_dict()),
        "present_url": request.build_absolute_uri(
            reverse("hanns:present", args=[deck.code])),
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
    deck = get_object_or_404(Deck, code=code.upper(), owner=request.user)
    try:
        payload = json.loads(request.body or "{}")
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
                "transition": s.get("transition", "fade"),
                "notes": s.get("notes", ""),
                "els": s.get("els", []) if isinstance(s.get("els"), list) else [],
            }))
        Slide.objects.bulk_create(bulk)

    return JsonResponse({"ok": True, "saved": deck.slides.count(),
                         "updated_at": deck.updated_at.isoformat()})


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
