from django.contrib.syndication.views import Feed
from django.urls import reverse
from django.utils.feedgenerator import Atom1Feed

from .models import Kind, Publication


class PublicationFeed(Feed):
    feed_type = Atom1Feed
    title = "KnockKnock publications"
    link = "/p/"
    description = "Datasets, decks, boards and articles published on KnockKnock."

    def get_object(self, request, *args, **kwargs):
        kind = request.GET.get("kind")
        return kind if kind in Kind.values else None

    def items(self, obj):
        qs = Publication.objects.live().order_by("-published_at")
        if obj:
            qs = qs.filter(kind=obj)
        return qs.prefetch_related("authors")[:40]

    def item_title(self, item):
        return item.title

    def item_description(self, item):
        return item.abstract or item.subtitle

    def item_link(self, item):
        return reverse("publish:detail", args=[item.slug])

    def item_pubdate(self, item):
        return item.published_at

    def item_updateddate(self, item):
        return item.updated_at

    def item_author_name(self, item):
        return item.author_line()

    def item_categories(self, item):
        return [item.kind_label] + [t.name for t in item.tags.all()]
