"""
Freezing.

At publish time we copy the source into real files and checksum them. From then
on the publication reads from those files, never from the live deck or survey.
That is the whole point: a reader who cites version 1 can still get version 1
after you have edited the original ten times.
"""

import hashlib
import logging

from django.core.files.base import ContentFile
from django.db import transaction
from django.utils import timezone

from . import sources
from .models import PublicationAsset, PublicationVersion, Status

log = logging.getLogger(__name__)


class FreezeError(Exception):
    pass


def freeze(publication, actor=None, changelog=""):
    """Build every asset for the publication's current version. Idempotent."""
    adapter = sources.adapter_for(publication.kind)
    if adapter is None:
        raise FreezeError("There is no way to publish a %s." % publication.kind)

    obj = None
    if adapter.needs_source:
        obj = adapter.fetch(publication.owner, publication.source_ref)
        if obj is None:
            raise FreezeError(
                "The %s this was made from is gone or is no longer yours." % adapter.noun)
        publication.source_label = adapter.title_of(obj)

    try:
        built = adapter.build_assets(publication, obj)
    except Exception as exc:                       # a broken source must not 500 the editor
        log.exception("freeze failed for %s", publication.pk)
        raise FreezeError("Could not read the %s: %s" % (adapter.noun, exc))

    with transaction.atomic():
        publication.assets.filter(version=publication.version).delete()
        for spec in built:
            asset = PublicationAsset(
                publication=publication,
                version=publication.version,
                role=spec.role,
                label=spec.label,
                media_type=spec.media_type,
                extension=spec.filename.rsplit(".", 1)[-1].lower() if "." in spec.filename else "",
                byte_size=len(spec.content),
                checksum=hashlib.sha256(spec.content).hexdigest(),
                row_count=spec.row_count,
                column_count=spec.column_count,
                order=spec.order,
            )
            asset.file.save(spec.filename, ContentFile(spec.content), save=False)
            asset.save()

        publication.estimate_reading_time()
        publication.save()

        PublicationVersion.objects.update_or_create(
            publication=publication,
            number=publication.version,
            defaults={
                "changelog": changelog,
                "published_at": timezone.now(),
                "created_by": actor,
                "snapshot": snapshot(publication),
            },
        )
    return publication.assets.filter(version=publication.version)


def snapshot(publication):
    """A small, honest record of what version N actually said."""
    return {
        "title": publication.title,
        "subtitle": publication.subtitle,
        "abstract": publication.abstract,
        "kind": publication.kind,
        "variant": publication.source_variant,
        "source_label": publication.source_label,
        "license": publication.license,
        "authors": [
            {"name": a.display_name, "affiliation": a.affiliation, "role": a.role}
            for a in publication.authors.all()
        ],
        "tags": [t.name for t in publication.tags.all()],
        "meta": publication.meta,
        "assets": [
            {"label": a.label, "bytes": a.byte_size, "sha256": a.checksum,
             "rows": a.row_count, "columns": a.column_count}
            for a in publication.assets.filter(version=publication.version)
        ],
    }


def start_new_version(publication, changelog=""):
    """Bump to v(n+1) and refreeze. The old version's files stay on disk."""
    publication.version += 1
    publication.status = Status.DRAFT
    publication.save(update_fields=["version", "status", "updated_at"])
    publication.meta["pending_changelog"] = changelog
    return publication
