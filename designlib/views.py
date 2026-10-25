"""JSON API for the design library (used by static/hanns/js/hanns_library.js).

    GET  /designlib/                 your bookmarks
    POST /designlib/                 save one   {name, els, w, h, kind, prompt, tags, color}
    POST /designlib/<id>/            update     {name?, pinned?, tags?} or {"use": true}
    POST /designlib/<id>/delete/     remove
"""

import json
import re

from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.http import require_http_methods, require_POST

from .models import MAX_JSON_BYTES, MAX_PER_USER, DesignBookmark

TAG_RE = re.compile(r"^[\w &+-]{1,24}$")
COLOR_RE = re.compile(r"^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\))$")


def _clean_tags(v):
    out = []
    for t in v if isinstance(v, list) else []:
        t = str(t).strip()
        if TAG_RE.match(t) and t.lower() not in (x.lower() for x in out):
            out.append(t)
    return out[:8]


def _strip_inline_images(node):
    """Uploaded images live in /media; big inline data: URIs would bloat
    every library load, so they are dropped (the element stays, empty)."""
    if isinstance(node, dict):
        return {k: ("" if isinstance(v, str) and v.startswith("data:") and len(v) > 4000 else _strip_inline_images(v))
                for k, v in node.items()}
    if isinstance(node, list):
        return [_strip_inline_images(x) for x in node]
    return node


def _bad(msg, status=400):
    return JsonResponse({"ok": False, "error": msg}, status=status)


@login_required
@require_http_methods(["GET", "POST"])
def bookmarks(request):
    if request.method == "GET":
        items = DesignBookmark.objects.filter(owner=request.user)[:MAX_PER_USER]
        return JsonResponse({"ok": True, "items": [b.as_dict() for b in items]})
    try:
        p = json.loads(request.body or "{}")
    except ValueError:
        return _bad("That request was malformed.")
    els = p.get("els")
    if not isinstance(els, list) or not els or not all(isinstance(e, dict) and e.get("type") for e in els):
        return _bad("Select something to bookmark first.")
    els = _strip_inline_images(els[:60])
    if len(json.dumps(els)) > MAX_JSON_BYTES:
        return _bad("That design is too big to bookmark — try fewer elements.")
    if DesignBookmark.objects.filter(owner=request.user).count() >= MAX_PER_USER:
        return _bad(f"Your library is full ({MAX_PER_USER} designs) — delete a few first.")
    try:
        w = max(4, min(4000, int(float(p.get("w") or 100))))
        h = max(4, min(4000, int(float(p.get("h") or 100))))
    except (TypeError, ValueError):
        return _bad("Bad size.")
    color = str(p.get("color") or "")[:32]
    b = DesignBookmark.objects.create(
        owner=request.user,
        name=(" ".join(str(p.get("name") or "").split())[:80] or "Untitled design"),
        kind="ai" if p.get("kind") == "ai" else "selection",
        els=els, w=w, h=h,
        prompt=str(p.get("prompt") or "")[:600],
        tags=_clean_tags(p.get("tags")),
        color=color if COLOR_RE.match(color) else "",
    )
    return JsonResponse({"ok": True, "item": b.as_dict()}, status=201)


@login_required
@require_POST
def bookmark(request, pk):
    b = get_object_or_404(DesignBookmark, pk=pk, owner=request.user)
    try:
        p = json.loads(request.body or "{}")
    except ValueError:
        return _bad("That request was malformed.")
    fields = []
    if p.get("use"):
        b.uses += 1
        b.last_used_at = timezone.now()
        fields += ["uses", "last_used_at"]
    if "name" in p:
        name = " ".join(str(p.get("name") or "").split())[:80]
        if name:
            b.name = name
            fields.append("name")
    if "pinned" in p:
        b.pinned = bool(p.get("pinned"))
        fields.append("pinned")
    if "tags" in p:
        b.tags = _clean_tags(p.get("tags"))
        fields.append("tags")
    if fields:
        b.save(update_fields=fields)
    return JsonResponse({"ok": True, "item": b.as_dict()})


@login_required
@require_POST
def delete(request, pk):
    get_object_or_404(DesignBookmark, pk=pk, owner=request.user).delete()
    return JsonResponse({"ok": True})
