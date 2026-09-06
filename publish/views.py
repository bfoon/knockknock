"""
Views.

Class-based with manual POST handling, matching the rest of KnockKnock. No
Django forms; every writable field is whitelisted in ALLOWED_FIELDS and clamped
on the way in.
"""

import json
import mimetypes

from django.conf import settings
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.core.exceptions import PermissionDenied
from django.db.models import Prefetch, Q
from django.http import (FileResponse, Http404, HttpResponse, HttpResponseBadRequest,
                         HttpResponseRedirect, JsonResponse)
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views import View

from . import assets as freezer
from . import citation, ogimage, plans, sources
from .models import (LICENSE_CHOICES, SHARE_CHANNELS, SHARE_CHANNEL_KEYS, AssetRole,
                     Kind, MetricDay, Publication, PublicationAuthor, PublicationBlock,
                     ReviewNote, ShareEvent, Status, Tag, Visibility)

PAGE_SIZE = 18

ALLOWED_FIELDS = {
    "title": 220, "subtitle": 300, "abstract": 4000, "cover_credit": 200,
    "funding": 300, "collected_between": 120, "coverage_area": 160,
}


def _clean(request, field, default=""):
    raw = (request.POST.get(field) or default).strip()
    limit = ALLOWED_FIELDS.get(field)
    return raw[:limit] if limit else raw


def _base_context(request):
    return {
        "base_template": getattr(settings, "PUBLISH_BASE_TEMPLATE", "publish/base.html"),
        "gate": plans.publish_gate(request.user),
        "can_review": plans.can_review(request.user),
    }


# --------------------------------------------------------------------------- #
# reading
# --------------------------------------------------------------------------- #

class FeedView(View):
    """The index at /p/ and the source of the home page strip."""

    def get(self, request):
        qs = (Publication.objects.live()
              .select_related("owner")
              .prefetch_related("authors", "tags"))

        kind = request.GET.get("kind", "")
        if kind in Kind.values:
            qs = qs.filter(kind=kind)

        tag = request.GET.get("tag", "")
        if tag:
            qs = qs.filter(tags__slug=tag)

        query = (request.GET.get("q") or "").strip()
        if query:
            qs = qs.filter(Q(title__icontains=query) | Q(abstract__icontains=query)
                           | Q(subtitle__icontains=query) | Q(tags__name__icontains=query)).distinct()

        sort = request.GET.get("sort", "recent")
        if sort == "read":
            qs = qs.order_by("-views_count", "-published_at")
        elif sort == "downloaded":
            qs = qs.order_by("-downloads_count", "-published_at")
        else:
            qs = qs.order_by("-published_at")

        page = max(1, int(request.GET.get("page") or 1))
        start = (page - 1) * PAGE_SIZE
        rows = list(qs[start:start + PAGE_SIZE + 1])
        has_next = len(rows) > PAGE_SIZE
        rows = rows[:PAGE_SIZE]

        lead = None
        if page == 1 and not (kind or tag or query):
            lead = (Publication.objects.live().filter(featured=True)
                    .order_by("-featured_at").first()) or (rows[0] if rows else None)
            if lead is not None:
                rows = [r for r in rows if r.pk != lead.pk]

        ctx = _base_context(request)
        ctx.update({
            "lead": lead,
            "publications": rows,
            "kinds": [(k.value, k.label) for k in Kind],
            "active_kind": kind,
            "query": query,
            "sort": sort,
            "tag": tag,
            "page": page,
            "has_next": has_next,
            "counts": {k.value: Publication.objects.live().filter(kind=k.value).count() for k in Kind},
            "popular_tags": Tag.objects.filter(publications__status=Status.PUBLISHED)
                               .distinct().order_by("-uses", "name")[:14],
        })
        return render(request, "publish/feed.html", ctx)


class DetailView(View):
    def get(self, request, slug):
        pub = get_object_or_404(
            Publication.objects.select_related("owner").prefetch_related(
                "authors", "tags",
                Prefetch("blocks", queryset=PublicationBlock.objects.order_by("order")),
            ),
            slug=slug,
        )
        if not pub.can_view(request.user):
            raise Http404

        if pub.is_live and not request.session.get("seen_pub_%s" % pub.pk):
            pub.touch_view()
            request.session["seen_pub_%s" % pub.pk] = True

        adapter = sources.adapter_for(pub.kind)
        ctx = _base_context(request)
        ctx.update({
            "pub": pub,
            "adapter": adapter,
            "authors": list(pub.authors.all()),
            "blocks": list(pub.blocks.all()),
            "assets": list(pub.current_assets()),
            "versions": list(pub.versions.all()),
            "toc": [b for b in pub.blocks.all() if b.type == "heading"],
            "canonical": pub.canonical_url(request),
            "share_channels": SHARE_CHANNELS,
            "json_ld": citation.json_ld_script(pub, pub.canonical_url(request)),
            "apa": citation.apa(pub, pub.canonical_url(request)),
            "bibtex": citation.bibtex(pub, pub.canonical_url(request)),
            "ris": citation.ris(pub, pub.canonical_url(request)),
            "can_edit": pub.can_edit(request.user),
            "embed_code": '<iframe src="%s" width="100%%" height="520" frameborder="0" '
                          'loading="lazy" title="%s"></iframe>'
                          % (request.build_absolute_uri(pub.embed_url()), pub.title.replace('"', "'")),
        })
        if adapter is not None:
            ctx.update(adapter.reader_context(pub))
        return render(request, "publish/detail.html", ctx)


class EmbedView(View):
    def get(self, request, slug):
        pub = get_object_or_404(Publication, slug=slug)
        if not pub.can_view(request.user) or not pub.allow_embed:
            raise Http404
        adapter = sources.adapter_for(pub.kind)
        ctx = {"pub": pub, "canonical": pub.canonical_url(request),
               "assets": list(pub.current_assets())}
        if adapter is not None:
            ctx.update(adapter.reader_context(pub))
        response = render(request, "publish/embed.html", ctx)
        response["X-Frame-Options"] = "ALLOWALL"
        response["Content-Security-Policy"] = "frame-ancestors *"
        return response


class PlayerView(View):
    """Serves a frozen HTML deck inline, sandboxed."""

    def get(self, request, slug):
        pub = get_object_or_404(Publication, slug=slug)
        if not pub.can_view(request.user):
            raise Http404
        asset = pub.current_assets().filter(role=AssetRole.PRIMARY, extension="html").first()
        if asset is None:
            raise Http404
        asset.file.open("rb")
        html = asset.file.read()
        asset.file.close()
        response = HttpResponse(html, content_type="text/html; charset=utf-8")
        response["Content-Security-Policy"] = "frame-ancestors 'self' *"
        return response


class OgImageView(View):
    def get(self, request, slug):
        pub = get_object_or_404(Publication, slug=slug)
        if not pub.can_view(request.user):
            raise Http404
        stored = ogimage.ensure(pub)
        if stored:
            return HttpResponseRedirect(stored.url)
        try:
            return HttpResponse(ogimage.render(pub), content_type="image/png")
        except Exception:
            raise Http404


class QrView(View):
    """QR for the publication link. Uses whichever QR library the project already has."""

    def get(self, request, slug):
        pub = get_object_or_404(Publication, slug=slug)
        if not pub.can_view(request.user):
            raise Http404
        url = pub.canonical_url(request)
        try:
            import qrcode
            import io
            img = qrcode.make(url, box_size=8, border=2)
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            return HttpResponse(buf.getvalue(), content_type="image/png")
        except Exception:
            pass
        try:
            import segno
            import io
            buf = io.BytesIO()
            segno.make(url).save(buf, kind="png", scale=8, border=2)
            return HttpResponse(buf.getvalue(), content_type="image/png")
        except Exception:
            raise Http404


class CiteView(View):
    FORMATS = {"apa": ("text/plain", citation.apa),
               "bib": ("application/x-bibtex", citation.bibtex),
               "ris": ("application/x-research-info-systems", citation.ris)}

    def get(self, request, slug, fmt):
        pub = get_object_or_404(Publication, slug=slug)
        if not pub.can_view(request.user):
            raise Http404
        if fmt == "json":
            return JsonResponse(citation.json_ld(pub, pub.canonical_url(request)))
        if fmt not in self.FORMATS:
            raise Http404
        mime, builder = self.FORMATS[fmt]
        body = builder(pub, pub.canonical_url(request))
        response = HttpResponse(body, content_type="%s; charset=utf-8" % mime)
        response["Content-Disposition"] = 'attachment; filename="%s.%s"' % (pub.citation_key, fmt)
        return response


class DownloadView(View):
    def get(self, request, slug, asset_id):
        pub = get_object_or_404(Publication, slug=slug)
        if not pub.can_view(request.user):
            raise Http404
        asset = get_object_or_404(pub.assets, pk=asset_id)
        Publication.objects.filter(pk=pub.pk).update(downloads_count=Publication.objects.filter(
            pk=pub.pk).values_list("downloads_count", flat=True)[0] + 1)
        asset.__class__.objects.filter(pk=asset.pk).update(download_count=asset.download_count + 1)
        MetricDay.bump(pub, "downloads")
        content_type = asset.media_type or mimetypes.guess_type(asset.file.name)[0] \
            or "application/octet-stream"
        response = FileResponse(asset.file.open("rb"), content_type=content_type)
        response["Content-Disposition"] = 'attachment; filename="%s"' % asset.file.name.split("/")[-1]
        return response


class ShareView(View):
    """Records the channel, then sends the reader on. One row per share, no cookies."""

    TARGETS = {
        "x": "https://twitter.com/intent/tweet?text={title}&url={url}",
        "linkedin": "https://www.linkedin.com/sharing/share-offsite/?url={url}",
        "facebook": "https://www.facebook.com/sharer/sharer.php?u={url}",
        "whatsapp": "https://api.whatsapp.com/send?text={title}%20{url}",
        "telegram": "https://t.me/share/url?url={url}&text={title}",
        "email": "mailto:?subject={title}&body={url}",
    }

    def get(self, request, slug, channel):
        return self._record(request, slug, channel, redirect_out=True)

    def post(self, request, slug, channel):
        return self._record(request, slug, channel, redirect_out=False)

    def _record(self, request, slug, channel, redirect_out):
        pub = get_object_or_404(Publication, slug=slug)
        if not pub.can_view(request.user) or channel not in SHARE_CHANNEL_KEYS:
            raise Http404
        ShareEvent.objects.create(publication=pub, channel=channel)
        Publication.objects.filter(pk=pub.pk).update(
            shares_count=Publication.objects.filter(pk=pub.pk)
            .values_list("shares_count", flat=True)[0] + 1)
        MetricDay.bump(pub, "shares")
        if redirect_out and channel in self.TARGETS:
            from urllib.parse import quote
            url = self.TARGETS[channel].format(
                url=quote(pub.canonical_url(request), safe=""),
                title=quote(pub.title, safe=""))
            return HttpResponseRedirect(url)
        return JsonResponse({"ok": True, "shares": pub.shares_count + 1})


class OEmbedView(View):
    def get(self, request):
        url = request.GET.get("url", "")
        slug = url.rstrip("/").rsplit("/", 1)[-1] if url else ""
        pub = Publication.objects.filter(slug=slug, status=Status.PUBLISHED).first()
        if pub is None or not pub.allow_embed:
            raise Http404
        return JsonResponse({
            "version": "1.0",
            "type": "rich",
            "provider_name": "KnockKnock",
            "provider_url": request.build_absolute_uri("/"),
            "title": pub.title,
            "author_name": pub.author_line(),
            "width": 720,
            "height": 520,
            "thumbnail_url": request.build_absolute_uri(pub.og_url()),
            "html": '<iframe src="%s" width="720" height="520" frameborder="0" '
                    'loading="lazy"></iframe>' % request.build_absolute_uri(pub.embed_url()),
        })


# --------------------------------------------------------------------------- #
# studio
# --------------------------------------------------------------------------- #

@method_decorator(login_required, name="dispatch")
class StudioView(View):
    def get(self, request):
        mine = (Publication.objects.filter(Q(owner=request.user) | Q(authors__user=request.user))
                .distinct().order_by("-updated_at").prefetch_related("authors"))
        ctx = _base_context(request)
        ctx.update({
            "publications": list(mine),
            "adapters": sources.available_adapters(),
            "kinds": [(k.value, k.label) for k in Kind],
        })
        return render(request, "publish/studio.html", ctx)


@method_decorator(login_required, name="dispatch")
class NewView(View):
    """Step 1: pick a kind, then pick the thing."""

    def get(self, request):
        kind = request.GET.get("kind", "")
        adapter = sources.adapter_for(kind)
        ctx = _base_context(request)
        ctx.update({
            "adapters": sources.available_adapters(),
            "adapter": adapter,
            "kind": kind,
            "items": adapter.list_for_user(request.user) if adapter and adapter.needs_source else [],
        })
        return render(request, "publish/new.html", ctx)

    def post(self, request):
        kind = request.POST.get("kind", "")
        adapter = sources.adapter_for(kind)
        if adapter is None or not adapter.available():
            return HttpResponseBadRequest("Unknown kind.")
        ref = (request.POST.get("ref") or "").strip()
        obj = None
        if adapter.needs_source:
            obj = adapter.fetch(request.user, ref)
            if obj is None:
                messages.error(request, "Pick something of yours to publish.")
                return redirect("%s?kind=%s" % (reverse("publish:new"), kind))

        pub = Publication.objects.create(
            kind=kind,
            owner=request.user,
            title=(adapter.title_of(obj) if obj is not None else "Untitled article")[:220],
            source_app=kind,
            source_ref=ref,
            source_label=adapter.title_of(obj) if obj is not None else "",
            source_variant=(request.POST.get("variant") or
                            (adapter.variants[0][0] if adapter.variants else "")),
        )
        PublicationAuthor.objects.create(
            publication=pub, user=request.user, order=0, is_corresponding=True,
            name=request.user.get_full_name() or request.user.get_username(),
        )
        return redirect("publish:edit", pk=pub.pk)


@method_decorator(login_required, name="dispatch")
class EditView(View):
    def get_object(self, request, pk):
        pub = get_object_or_404(Publication, pk=pk)
        if not pub.can_edit(request.user):
            raise PermissionDenied
        return pub

    def get(self, request, pk):
        pub = self.get_object(request, pk)
        adapter = sources.adapter_for(pub.kind)
        ctx = _base_context(request)
        ctx.update({
            "pub": pub,
            "adapter": adapter,
            "authors": list(pub.authors.all()),
            "blocks": list(pub.blocks.all()),
            "assets": list(pub.current_assets()),
            "licenses": LICENSE_CHOICES,
            "visibilities": [(v.value, v.label) for v in Visibility],
            "tag_string": ", ".join(t.name for t in pub.tags.all()),
            "notes": list(pub.review_notes.all()[:20]),
            "blocks_json": json.dumps([
                {"id": str(b.id), "type": b.type, "text": b.text, "caption": b.caption,
                 "url": b.url, "data": b.data, "image": b.image.url if b.image else ""}
                for b in pub.blocks.all()
            ]),
        })
        return render(request, "publish/edit.html", ctx)

    def post(self, request, pk):
        pub = self.get_object(request, pk)
        for field in ALLOWED_FIELDS:
            if field in request.POST:
                setattr(pub, field, _clean(request, field))
        if not pub.title:
            pub.title = "Untitled"
        if request.POST.get("license") in dict(LICENSE_CHOICES):
            pub.license = request.POST["license"]
        if request.POST.get("visibility") in Visibility.values:
            pub.visibility = request.POST["visibility"]
        if request.POST.get("language"):
            pub.language = request.POST["language"][:12]
        if request.POST.get("variant"):
            adapter = sources.adapter_for(pub.kind)
            allowed = [v for v, _ in (adapter.variants if adapter else [])]
            if request.POST["variant"] in allowed:
                pub.source_variant = request.POST["variant"]
        pub.allow_embed = request.POST.get("allow_embed") == "on"
        if request.FILES.get("cover"):
            pub.cover = request.FILES["cover"]
            pub.og_image = None
        pub.save()

        if "tags" in request.POST:
            names = [n.strip() for n in request.POST["tags"].split(",") if n.strip()][:12]
            tags = [t for t in (Tag.get_or_make(n) for n in names) if t]
            pub.tags.set(tags)

        self._save_authors(request, pub)
        self._save_blocks(request, pub)

        messages.success(request, "Saved.")
        if request.headers.get("x-requested-with") == "XMLHttpRequest":
            return JsonResponse({"ok": True, "saved_at": timezone.now().isoformat()})
        return redirect("publish:edit", pk=pub.pk)

    @staticmethod
    def _save_authors(request, pub):
        raw = request.POST.get("authors_json")
        if not raw:
            return
        try:
            rows = json.loads(raw)
        except ValueError:
            return
        pub.authors.all().delete()
        for i, row in enumerate(rows[:30]):
            if not isinstance(row, dict):
                continue
            name = str(row.get("name", "")).strip()[:140]
            if not name:
                continue
            PublicationAuthor.objects.create(
                publication=pub, name=name, order=i,
                affiliation=str(row.get("affiliation", ""))[:200],
                email=str(row.get("email", ""))[:254],
                orcid=str(row.get("orcid", ""))[:40],
                role=str(row.get("role", ""))[:80],
                is_corresponding=bool(row.get("corresponding")),
            )

    @staticmethod
    def _save_blocks(request, pub):
        raw = request.POST.get("blocks_json")
        if raw is None:
            return
        try:
            rows = json.loads(raw)
        except ValueError:
            return
        keep = []
        figure = 0
        from django.utils.text import slugify
        for i, row in enumerate(rows[:400]):
            if not isinstance(row, dict):
                continue
            btype = row.get("type")
            if btype not in dict(PublicationBlock._meta.get_field("type").choices):
                continue
            block = None
            if row.get("id"):
                block = pub.blocks.filter(pk=row["id"]).first()
            if block is None:
                block = PublicationBlock(publication=pub)
            block.order = i
            block.type = btype
            block.text = str(row.get("text", ""))[:60000]
            block.caption = str(row.get("caption", ""))[:400]
            block.url = str(row.get("url", ""))[:200]
            block.data = row.get("data") if isinstance(row.get("data"), (dict, list)) else {}
            if btype == "heading":
                block.anchor = slugify(block.text)[:80] or "section-%d" % i
            if btype == "figure":
                figure += 1
                block.figure_number = figure
            block.save()
            keep.append(block.pk)
        pub.blocks.exclude(pk__in=keep).delete()


@method_decorator(login_required, name="dispatch")
class BlockImageView(View):
    """Figure upload from the editor."""

    def post(self, request, pk):
        pub = get_object_or_404(Publication, pk=pk)
        if not pub.can_edit(request.user):
            raise PermissionDenied
        upload = request.FILES.get("image")
        if upload is None:
            return HttpResponseBadRequest("No image.")
        limit = getattr(settings, "PUBLISH_MAX_IMAGE_BYTES", 8 * 1024 * 1024)
        if upload.size > limit:
            return JsonResponse({"ok": False, "error": "That image is over %d MB."
                                 % (limit // (1024 * 1024))}, status=400)
        try:
            from PIL import Image
            Image.open(upload).verify()
            upload.seek(0)
        except Exception:
            return JsonResponse({"ok": False, "error": "That file is not an image."}, status=400)
        block = PublicationBlock.objects.create(
            publication=pub, type="figure",
            order=pub.blocks.count(), image=upload,
        )
        return JsonResponse({"ok": True, "id": str(block.id), "url": block.image.url})


@method_decorator(login_required, name="dispatch")
class ActionView(View):
    """publish / unpublish / archive / new-version / delete."""

    def post(self, request, pk, action):
        pub = get_object_or_404(Publication, pk=pk)
        if not pub.can_edit(request.user):
            raise PermissionDenied
        handler = getattr(self, "do_%s" % action.replace("-", "_"), None)
        if handler is None:
            return HttpResponseBadRequest("Unknown action.")
        return handler(request, pub)

    def do_publish(self, request, pub):
        if not pub.title.strip() or not pub.abstract.strip():
            messages.error(request, "Give it a title and a short summary before publishing.")
            return redirect("publish:edit", pk=pub.pk)
        try:
            freezer.freeze(pub, actor=request.user,
                           changelog=pub.meta.pop("pending_changelog", ""))
        except freezer.FreezeError as exc:
            messages.error(request, str(exc))
            return redirect("publish:edit", pk=pub.pk)

        if plans.can_publish_instantly(request.user):
            pub.mark_published(actor=request.user)
            ogimage.ensure(pub, force=True)
            messages.success(request, "Published. It is on the home page now.")
            return redirect("publish:detail", slug=pub.slug)

        pub.status = Status.IN_REVIEW
        pub.submitted_at = timezone.now()
        pub.save(update_fields=["status", "submitted_at", "updated_at"])
        ReviewNote.objects.create(publication=pub, author=request.user, decision="submitted",
                                  body=request.POST.get("note", "")[:2000])
        messages.success(request, "Sent for review. An editor will read it and let you know.")
        return redirect("publish:studio")

    def do_unpublish(self, request, pub):
        pub.status = Status.DRAFT
        pub.save(update_fields=["status", "updated_at"])
        messages.success(request, "Taken down. It is a draft again.")
        return redirect("publish:edit", pk=pub.pk)

    def do_archive(self, request, pub):
        pub.status = Status.ARCHIVED
        pub.save(update_fields=["status", "updated_at"])
        messages.success(request, "Archived. The page still resolves for anyone who cited it.")
        return redirect("publish:studio")

    def do_new_version(self, request, pub):
        freezer.start_new_version(pub, changelog=request.POST.get("changelog", "")[:2000])
        pub.save()
        messages.success(request, "Version %d started. Publish it when you are ready." % pub.version)
        return redirect("publish:edit", pk=pub.pk)

    def do_delete(self, request, pub):
        if pub.first_published_at:
            messages.error(request, "This has been published, so it can be archived but not deleted.")
            return redirect("publish:edit", pk=pub.pk)
        pub.delete()
        messages.success(request, "Deleted.")
        return redirect("publish:studio")


@method_decorator(login_required, name="dispatch")
class SourceListView(View):
    """JSON list behind the picker, so the page does not reload on every filter."""

    def get(self, request, kind):
        adapter = sources.adapter_for(kind)
        if adapter is None or not adapter.available():
            return JsonResponse({"items": []})
        return JsonResponse({"items": [i.as_dict() for i in adapter.list_for_user(request.user)]})


# --------------------------------------------------------------------------- #
# review queue
# --------------------------------------------------------------------------- #

@method_decorator(login_required, name="dispatch")
class ReviewQueueView(View):
    def get(self, request):
        if not plans.can_review(request.user):
            raise PermissionDenied
        ctx = _base_context(request)
        ctx.update({
            "waiting": list(Publication.objects.filter(status=Status.IN_REVIEW)
                            .order_by("submitted_at").prefetch_related("authors")),
            "recent": list(Publication.objects.filter(status=Status.PUBLISHED)
                           .order_by("-published_at")[:12]),
        })
        return render(request, "publish/review.html", ctx)

    def post(self, request):
        if not plans.can_review(request.user):
            raise PermissionDenied
        pub = get_object_or_404(Publication, pk=request.POST.get("pk"))
        decision = request.POST.get("decision")
        note = (request.POST.get("note") or "")[:2000]
        if decision == "approve":
            pub.mark_published(actor=request.user)
            ogimage.ensure(pub, force=True)
        elif decision == "changes":
            pub.status = Status.CHANGES
            pub.reviewed_by = request.user
            pub.reviewed_at = timezone.now()
            pub.save()
        elif decision == "feature":
            pub.featured = True
            pub.featured_at = timezone.now()
            pub.save(update_fields=["featured", "featured_at"])
        elif decision == "unfeature":
            pub.featured = False
            pub.save(update_fields=["featured"])
        else:
            return HttpResponseBadRequest("Unknown decision.")
        ReviewNote.objects.create(publication=pub, author=request.user,
                                  decision=decision if decision in ("approve", "changes") else "comment",
                                  body=note)
        messages.success(request, "Done.")
        return redirect("publish:review")


# --------------------------------------------------------------------------- #
# helper for the KnockKnock home page
# --------------------------------------------------------------------------- #

def home_publications(limit=6):
    """Import this in core/views.py to fill the Publications strip."""
    return list(Publication.objects.live()
                .select_related("owner")
                .prefetch_related("authors")
                .order_by("-featured", "-published_at")[:limit])
