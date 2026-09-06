"""
Publication models for KnockKnock.

Design notes
------------
* Nothing here imports hanns / kura / chalk / cards. A publication points at its
  source with (source_app, source_ref) and everything app-specific lives behind a
  SourceAdapter in publish/sources.py. That means no migrations in other apps and
  the publication app still boots if one of them is missing.
* A published record is FROZEN. PublicationAsset rows hold real files written at
  publish time, so editing the deck or re-cleaning the dataset afterwards cannot
  silently rewrite something a reader already cited. Changes become version 2.
"""

import hashlib
import uuid

from django.conf import settings
from django.db import models
from django.urls import reverse
from django.utils import timezone
from django.utils.text import slugify

USER = settings.AUTH_USER_MODEL


# --------------------------------------------------------------------------- #
# choices
# --------------------------------------------------------------------------- #

class Kind(models.TextChoices):
    ARTICLE = "article", "Article"
    DATASET = "dataset", "Dataset"
    DECK = "deck", "Slide deck"
    BOARD = "board", "Board"
    CARD = "card", "Card"
    SHOW = "show", "Show"


class Status(models.TextChoices):
    DRAFT = "draft", "Draft"
    IN_REVIEW = "in_review", "In review"
    CHANGES = "changes", "Changes requested"
    PUBLISHED = "published", "Published"
    ARCHIVED = "archived", "Archived"


class Visibility(models.TextChoices):
    PUBLIC = "public", "Public"
    UNLISTED = "unlisted", "Unlisted"
    PRIVATE = "private", "Private"


LICENSES = [
    ("cc-by-4.0", "Creative Commons Attribution 4.0", "https://creativecommons.org/licenses/by/4.0/"),
    ("cc-by-sa-4.0", "Creative Commons Attribution-ShareAlike 4.0", "https://creativecommons.org/licenses/by-sa/4.0/"),
    ("cc-by-nc-4.0", "Creative Commons Attribution-NonCommercial 4.0", "https://creativecommons.org/licenses/by-nc/4.0/"),
    ("cc0-1.0", "Public domain dedication (CC0 1.0)", "https://creativecommons.org/publicdomain/zero/1.0/"),
    ("odbl-1.0", "Open Database Licence 1.0", "https://opendatacommons.org/licenses/odbl/1-0/"),
    ("arr", "All rights reserved", ""),
]
LICENSE_CHOICES = [(code, label) for code, label, _url in LICENSES]
LICENSE_URLS = {code: url for code, _label, url in LICENSES}
LICENSE_LABELS = {code: label for code, label, _url in LICENSES}


CITATION_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no I, L, O, 0, 1


def make_citation_key():
    """Short, human-quotable, collision-checked at save time."""
    import secrets
    tail = "".join(secrets.choice(CITATION_ALPHABET) for _ in range(5))
    return "NK-%s-%s" % (timezone.now().year, tail)


# --------------------------------------------------------------------------- #
# tags
# --------------------------------------------------------------------------- #

class Tag(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=60, unique=True)
    slug = models.SlugField(max_length=70, unique=True)
    uses = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name

    @classmethod
    def get_or_make(cls, raw):
        name = " ".join(str(raw).split())[:60]
        if not name:
            return None
        slug = slugify(name)[:70] or None
        if not slug:
            return None
        obj, _ = cls.objects.get_or_create(slug=slug, defaults={"name": name})
        return obj


# --------------------------------------------------------------------------- #
# publication
# --------------------------------------------------------------------------- #

class PublicationQuerySet(models.QuerySet):
    def live(self):
        return self.filter(status=Status.PUBLISHED, visibility=Visibility.PUBLIC)

    def readable_by(self, user):
        q = models.Q(status=Status.PUBLISHED, visibility=Visibility.PUBLIC)
        if getattr(user, "is_authenticated", False):
            q |= models.Q(owner=user) | models.Q(authors__user=user)
            if user.is_staff:
                q |= models.Q(pk__isnull=False)
        return self.filter(q).distinct()


class Publication(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(max_length=16, choices=Kind.choices, default=Kind.ARTICLE)
    owner = models.ForeignKey(USER, on_delete=models.CASCADE, related_name="publications")

    title = models.CharField(max_length=220)
    slug = models.SlugField(max_length=240, unique=True, blank=True)
    subtitle = models.CharField(max_length=300, blank=True)
    abstract = models.TextField(blank=True, help_text="A short summary. Shown in the index and in link previews.")
    cover = models.ImageField(upload_to="publications/covers/%Y/%m/", blank=True, null=True)
    cover_credit = models.CharField(max_length=200, blank=True)

    # what this was made from, resolved through publish.sources
    source_app = models.CharField(max_length=40, blank=True)
    source_ref = models.CharField(max_length=64, blank=True)
    source_label = models.CharField(max_length=220, blank=True, help_text="Name of the source at publish time.")
    source_variant = models.CharField(max_length=32, blank=True, help_text="e.g. clean / raw for a dataset.")

    tags = models.ManyToManyField(Tag, blank=True, related_name="publications")
    license = models.CharField(max_length=24, choices=LICENSE_CHOICES, default="cc-by-4.0")
    language = models.CharField(max_length=12, default="en")
    funding = models.CharField(max_length=300, blank=True)
    collected_between = models.CharField(max_length=120, blank=True, help_text="Free text period, e.g. Mar–Jun 2026.")
    coverage_area = models.CharField(max_length=160, blank=True, help_text="Where the work covers.")

    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT, db_index=True)
    visibility = models.CharField(max_length=12, choices=Visibility.choices, default=Visibility.PUBLIC)
    allow_embed = models.BooleanField(default=True)

    version = models.PositiveIntegerField(default=1)
    citation_key = models.CharField(max_length=24, unique=True, blank=True)

    featured = models.BooleanField(default=False, db_index=True)
    featured_at = models.DateTimeField(null=True, blank=True)

    submitted_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(USER, null=True, blank=True, on_delete=models.SET_NULL,
                                    related_name="publications_reviewed")
    reviewed_at = models.DateTimeField(null=True, blank=True)

    first_published_at = models.DateTimeField(null=True, blank=True)
    published_at = models.DateTimeField(null=True, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    reading_seconds = models.PositiveIntegerField(default=0)
    views_count = models.PositiveIntegerField(default=0)
    downloads_count = models.PositiveIntegerField(default=0)
    shares_count = models.PositiveIntegerField(default=0)

    og_image = models.ImageField(upload_to="publications/og/%Y/%m/", blank=True, null=True)
    meta = models.JSONField(default=dict, blank=True)

    objects = PublicationQuerySet.as_manager()

    class Meta:
        ordering = ["-published_at", "-created_at"]
        indexes = [
            models.Index(fields=["kind", "status"]),
            models.Index(fields=["status", "-published_at"]),
        ]

    def __str__(self):
        return self.title

    # -- saving ----------------------------------------------------------- #

    def save(self, *args, **kwargs):
        if not self.citation_key:
            for _ in range(12):
                key = make_citation_key()
                if not Publication.objects.filter(citation_key=key).exists():
                    self.citation_key = key
                    break
        if not self.slug:
            self.slug = self._unique_slug()
        super().save(*args, **kwargs)

    def _unique_slug(self):
        base = slugify(self.title)[:200] or "publication"
        slug = base
        n = 2
        while Publication.objects.filter(slug=slug).exclude(pk=self.pk).exists():
            slug = "%s-%d" % (base[:196], n)
            n += 1
        return slug

    # -- urls -------------------------------------------------------------- #

    def get_absolute_url(self):
        return reverse("publish:detail", args=[self.slug])

    def embed_url(self):
        return reverse("publish:embed", args=[self.slug])

    def og_url(self):
        if self.og_image:
            return self.og_image.url
        return reverse("publish:og", args=[self.slug])

    def canonical_url(self, request=None):
        path = self.get_absolute_url()
        if request is not None:
            return request.build_absolute_uri(path)
        base = getattr(settings, "PUBLISH_SITE_URL", "").rstrip("/")
        return base + path if base else path

    # -- state -------------------------------------------------------------- #

    @property
    def is_live(self):
        return self.status == Status.PUBLISHED

    @property
    def license_label(self):
        return LICENSE_LABELS.get(self.license, self.license)

    @property
    def license_url(self):
        return LICENSE_URLS.get(self.license, "")

    @property
    def kind_label(self):
        return Kind(self.kind).label if self.kind in Kind.values else self.kind

    def can_view(self, user):
        if self.status == Status.PUBLISHED and self.visibility in (Visibility.PUBLIC, Visibility.UNLISTED):
            return True
        if not getattr(user, "is_authenticated", False):
            return False
        if user.is_staff or self.owner_id == user.pk:
            return True
        return self.authors.filter(user=user).exists()

    def can_edit(self, user):
        if not getattr(user, "is_authenticated", False):
            return False
        return user.is_staff or self.owner_id == user.pk

    def author_line(self):
        names = [a.display_name for a in self.authors.all()]
        if not names:
            return self.owner.get_full_name() or self.owner.get_username()
        if len(names) == 1:
            return names[0]
        if len(names) == 2:
            return "%s and %s" % (names[0], names[1])
        return "%s and %d others" % (names[0], len(names) - 1)

    def primary_asset(self):
        return self.assets.filter(version=self.version, role=AssetRole.PRIMARY).first()

    def current_assets(self):
        return self.assets.filter(version=self.version)

    def estimate_reading_time(self):
        words = 0
        for b in self.blocks.all():
            words += len((b.text or "").split())
        words += len((self.abstract or "").split())
        self.reading_seconds = int(max(30, words / 230.0 * 60))
        return self.reading_seconds

    # -- transitions --------------------------------------------------------- #

    def mark_published(self, actor=None):
        now = timezone.now()
        self.status = Status.PUBLISHED
        self.published_at = now
        if not self.first_published_at:
            self.first_published_at = now
        if actor is not None:
            self.reviewed_by = actor
            self.reviewed_at = now
        self.save()

    def touch_view(self):
        Publication.objects.filter(pk=self.pk).update(views_count=models.F("views_count") + 1)
        MetricDay.bump(self, "views")


class PublicationAuthor(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    publication = models.ForeignKey(Publication, on_delete=models.CASCADE, related_name="authors")
    user = models.ForeignKey(USER, null=True, blank=True, on_delete=models.SET_NULL, related_name="authored_publications")
    name = models.CharField(max_length=140)
    affiliation = models.CharField(max_length=200, blank=True)
    email = models.EmailField(blank=True)
    orcid = models.CharField(max_length=40, blank=True)
    role = models.CharField(max_length=80, blank=True, help_text="e.g. Field coordinator, Analyst.")
    is_corresponding = models.BooleanField(default=False)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["order", "name"]

    def __str__(self):
        return self.name

    @property
    def display_name(self):
        return self.name or (self.user.get_full_name() if self.user else "") or "Unnamed"

    @property
    def surname_initials(self):
        """'Foon, B.' — used by the citation builder."""
        parts = [p for p in self.display_name.split() if p]
        if len(parts) == 1:
            return parts[0]
        surname = parts[-1]
        initials = " ".join("%s." % p[0].upper() for p in parts[:-1])
        return "%s, %s" % (surname, initials)


# --------------------------------------------------------------------------- #
# article body
# --------------------------------------------------------------------------- #

class BlockType(models.TextChoices):
    HEADING = "heading", "Heading"
    TEXT = "text", "Paragraph"
    FIGURE = "figure", "Figure"
    QUOTE = "quote", "Quote"
    LIST = "list", "List"
    CODE = "code", "Code"
    TABLE = "table", "Table"
    EMBED = "embed", "Embed"
    CALLOUT = "callout", "Callout"
    DIVIDER = "divider", "Divider"


class PublicationBlock(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    publication = models.ForeignKey(Publication, on_delete=models.CASCADE, related_name="blocks")
    order = models.PositiveIntegerField(default=0)
    type = models.CharField(max_length=16, choices=BlockType.choices, default=BlockType.TEXT)
    text = models.TextField(blank=True)
    caption = models.CharField(max_length=400, blank=True)
    image = models.ImageField(upload_to="publications/figures/%Y/%m/", blank=True, null=True)
    url = models.URLField(blank=True)
    data = models.JSONField(default=dict, blank=True)
    anchor = models.SlugField(max_length=80, blank=True)
    figure_number = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["order"]

    def __str__(self):
        return "%s #%d" % (self.type, self.order)


# --------------------------------------------------------------------------- #
# frozen assets and versions
# --------------------------------------------------------------------------- #

class AssetRole(models.TextChoices):
    PRIMARY = "primary", "Primary file"
    DATA = "data", "Data file"
    CODEBOOK = "codebook", "Codebook"
    PREVIEW = "preview", "Preview"
    THUMBNAIL = "thumbnail", "Thumbnail"
    EXTRA = "extra", "Supplementary"


def asset_path(instance, filename):
    return "publications/%s/v%d/%s" % (instance.publication_id, instance.version, filename)


class PublicationAsset(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    publication = models.ForeignKey(Publication, on_delete=models.CASCADE, related_name="assets")
    version = models.PositiveIntegerField(default=1)
    role = models.CharField(max_length=16, choices=AssetRole.choices, default=AssetRole.EXTRA)
    label = models.CharField(max_length=160)
    file = models.FileField(upload_to=asset_path)
    media_type = models.CharField(max_length=100, blank=True)
    extension = models.CharField(max_length=12, blank=True)
    byte_size = models.PositiveBigIntegerField(default=0)
    checksum = models.CharField(max_length=64, blank=True, help_text="sha256 of the frozen file.")
    row_count = models.PositiveIntegerField(null=True, blank=True)
    column_count = models.PositiveIntegerField(null=True, blank=True)
    download_count = models.PositiveIntegerField(default=0)
    order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["order", "role", "label"]
        indexes = [models.Index(fields=["publication", "version"])]

    def __str__(self):
        return "%s (%s)" % (self.label, self.extension or self.role)

    @property
    def size_human(self):
        n = float(self.byte_size or 0)
        for unit in ("B", "KB", "MB", "GB"):
            if n < 1024 or unit == "GB":
                return "%s %s" % (("%.0f" % n) if unit == "B" or n >= 10 else ("%.1f" % n), unit)
            n /= 1024.0
        return "%d B" % self.byte_size

    @property
    def short_checksum(self):
        return self.checksum[:12] if self.checksum else ""

    def download_url(self):
        return reverse("publish:download", args=[self.publication.slug, str(self.id)])

    def compute_checksum(self):
        h = hashlib.sha256()
        self.file.open("rb")
        try:
            for chunk in self.file.chunks(1024 * 256):
                h.update(chunk)
        finally:
            self.file.close()
        return h.hexdigest()


class PublicationVersion(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    publication = models.ForeignKey(Publication, on_delete=models.CASCADE, related_name="versions")
    number = models.PositiveIntegerField(default=1)
    changelog = models.TextField(blank=True)
    published_at = models.DateTimeField(default=timezone.now)
    created_by = models.ForeignKey(USER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    snapshot = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-number"]
        unique_together = [("publication", "number")]

    def __str__(self):
        return "%s v%d" % (self.publication_id, self.number)


# --------------------------------------------------------------------------- #
# review
# --------------------------------------------------------------------------- #

class ReviewNote(models.Model):
    DECISIONS = [
        ("submitted", "Submitted"),
        ("approved", "Approved"),
        ("changes", "Changes requested"),
        ("comment", "Comment"),
        ("unpublished", "Unpublished"),
    ]
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    publication = models.ForeignKey(Publication, on_delete=models.CASCADE, related_name="review_notes")
    author = models.ForeignKey(USER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    decision = models.CharField(max_length=16, choices=DECISIONS, default="comment")
    body = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


# --------------------------------------------------------------------------- #
# metrics
# --------------------------------------------------------------------------- #

SHARE_CHANNELS = [
    ("link", "Copied link"),
    ("embed", "Copied embed"),
    ("qr", "QR code"),
    ("x", "X"),
    ("linkedin", "LinkedIn"),
    ("facebook", "Facebook"),
    ("whatsapp", "WhatsApp"),
    ("telegram", "Telegram"),
    ("email", "Email"),
    ("native", "Device share sheet"),
]
SHARE_CHANNEL_KEYS = [c for c, _ in SHARE_CHANNELS]


class MetricDay(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    publication = models.ForeignKey(Publication, on_delete=models.CASCADE, related_name="metric_days")
    day = models.DateField(db_index=True)
    views = models.PositiveIntegerField(default=0)
    downloads = models.PositiveIntegerField(default=0)
    shares = models.PositiveIntegerField(default=0)

    class Meta:
        unique_together = [("publication", "day")]
        ordering = ["-day"]

    @classmethod
    def bump(cls, publication, field, amount=1):
        day = timezone.localdate()
        row, _ = cls.objects.get_or_create(publication=publication, day=day)
        cls.objects.filter(pk=row.pk).update(**{field: models.F(field) + amount})


class ShareEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    publication = models.ForeignKey(Publication, on_delete=models.CASCADE, related_name="share_events")
    channel = models.CharField(max_length=20, choices=SHARE_CHANNELS)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
