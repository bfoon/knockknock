"""
Behavioural tests for the publish app.

Run with:  python manage.py test publish
"""

import json

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.urls import reverse

from . import citation, plans, sources
from .models import Kind, Publication, PublicationAuthor, PublicationBlock, ShareEvent, Status

User = get_user_model()


def paid_resolver(user):
    return "pro" if user.username.startswith("paid") else "free"


class Base(TestCase):
    def setUp(self):
        self.free = User.objects.create_user("freddie", password="x", first_name="Fatou", last_name="Ceesay")
        self.paid = User.objects.create_user("paiduser", password="x", first_name="Baboucarr", last_name="Foon")
        self.editor = User.objects.create_user("editor", password="x", is_staff=True)

    def make(self, owner, **kw):
        pub = Publication.objects.create(
            owner=owner, kind=kw.pop("kind", Kind.ARTICLE),
            title=kw.pop("title", "Water points in the North Bank"),
            abstract=kw.pop("abstract", "A short summary of what we found."), **kw)
        PublicationAuthor.objects.create(publication=pub, user=owner, order=0,
                                         name=owner.get_full_name() or owner.username,
                                         affiliation="Easy Solutions", is_corresponding=True)
        return pub


# --------------------------------------------------------------------------- #

class PlanGateTests(Base):
    @override_settings(PUBLISH_PLAN_RESOLVER="publish.tests.paid_resolver",
                       PUBLISH_INSTANT_FOR_STAFF=False)
    def test_free_is_reviewed_paid_is_instant(self):
        self.assertFalse(plans.can_publish_instantly(self.free))
        self.assertTrue(plans.can_publish_instantly(self.paid))
        self.assertEqual(plans.publish_gate(self.free)["button_label"], "Send for review")
        self.assertEqual(plans.publish_gate(self.paid)["button_label"], "Publish")

    def test_unknown_plan_falls_back_to_free(self):
        self.assertEqual(plans.user_plan(self.free), "free")

    def test_anonymous_never_instant(self):
        class Anon:
            is_authenticated = False
        self.assertFalse(plans.can_publish_instantly(Anon()))

    def test_staff_can_review(self):
        self.assertTrue(plans.can_review(self.editor))
        self.assertFalse(plans.can_review(self.free))


@override_settings(PUBLISH_PLAN_RESOLVER="publish.tests.paid_resolver",
                   PUBLISH_INSTANT_FOR_STAFF=False)
class PublishFlowTests(Base):
    def test_free_publish_goes_to_review_not_the_home_page(self):
        pub = self.make(self.free)
        self.client.force_login(self.free)
        self.client.post(reverse("publish:action", args=[pub.pk, "publish"]))
        pub.refresh_from_db()
        self.assertEqual(pub.status, Status.IN_REVIEW)
        self.assertIsNotNone(pub.submitted_at)
        self.assertEqual(Publication.objects.live().count(), 0)

    def test_paid_publish_is_live_immediately(self):
        pub = self.make(self.paid)
        self.client.force_login(self.paid)
        self.client.post(reverse("publish:action", args=[pub.pk, "publish"]))
        pub.refresh_from_db()
        self.assertEqual(pub.status, Status.PUBLISHED)
        self.assertIsNotNone(pub.published_at)
        self.assertIsNotNone(pub.first_published_at)
        self.assertEqual(Publication.objects.live().count(), 1)

    def test_publish_refuses_without_a_summary(self):
        pub = self.make(self.paid, abstract="")
        self.client.force_login(self.paid)
        self.client.post(reverse("publish:action", args=[pub.pk, "publish"]))
        pub.refresh_from_db()
        self.assertEqual(pub.status, Status.DRAFT)

    def test_editor_approves_from_the_queue(self):
        pub = self.make(self.free)
        self.client.force_login(self.free)
        self.client.post(reverse("publish:action", args=[pub.pk, "publish"]))
        self.client.force_login(self.editor)
        response = self.client.post(reverse("publish:review"),
                                    {"pk": str(pub.pk), "decision": "approve", "note": "Good."})
        self.assertEqual(response.status_code, 302)
        pub.refresh_from_db()
        self.assertEqual(pub.status, Status.PUBLISHED)
        self.assertEqual(pub.reviewed_by, self.editor)
        self.assertEqual(pub.review_notes.filter(decision="approve").count(), 1)

    def test_editor_can_ask_for_changes(self):
        pub = self.make(self.free)
        self.client.force_login(self.free)
        self.client.post(reverse("publish:action", args=[pub.pk, "publish"]))
        self.client.force_login(self.editor)
        self.client.post(reverse("publish:review"),
                         {"pk": str(pub.pk), "decision": "changes", "note": "Add the method."})
        pub.refresh_from_db()
        self.assertEqual(pub.status, Status.CHANGES)

    def test_non_reviewer_cannot_open_the_queue(self):
        self.client.force_login(self.free)
        self.assertEqual(self.client.get(reverse("publish:review")).status_code, 403)

    def test_new_version_keeps_the_old_one_and_starts_a_draft(self):
        pub = self.make(self.paid)
        self.client.force_login(self.paid)
        self.client.post(reverse("publish:action", args=[pub.pk, "publish"]))
        self.client.post(reverse("publish:action", args=[pub.pk, "new-version"]),
                         {"changelog": "Fixed two districts."})
        pub.refresh_from_db()
        self.assertEqual(pub.version, 2)
        self.assertEqual(pub.status, Status.DRAFT)
        self.assertEqual(pub.versions.count(), 1)   # v1 record still there

    def test_published_work_cannot_be_deleted_only_archived(self):
        pub = self.make(self.paid)
        self.client.force_login(self.paid)
        self.client.post(reverse("publish:action", args=[pub.pk, "publish"]))
        self.client.post(reverse("publish:action", args=[pub.pk, "delete"]))
        self.assertTrue(Publication.objects.filter(pk=pub.pk).exists())
        self.client.post(reverse("publish:action", args=[pub.pk, "archive"]))
        pub.refresh_from_db()
        self.assertEqual(pub.status, Status.ARCHIVED)

    def test_a_stranger_cannot_edit(self):
        pub = self.make(self.paid)
        self.client.force_login(self.free)
        self.assertEqual(self.client.get(reverse("publish:edit", args=[pub.pk])).status_code, 403)


class VisibilityTests(Base):
    def test_draft_is_404_for_everyone_else(self):
        pub = self.make(self.paid)
        response = self.client.get(pub.get_absolute_url())
        self.assertEqual(response.status_code, 404)

    def test_owner_sees_their_own_draft(self):
        pub = self.make(self.paid)
        self.client.force_login(self.paid)
        self.assertEqual(self.client.get(pub.get_absolute_url()).status_code, 200)

    def test_unlisted_resolves_but_is_not_in_the_index(self):
        pub = self.make(self.paid, visibility="unlisted")
        pub.mark_published()
        self.assertEqual(self.client.get(pub.get_absolute_url()).status_code, 200)
        self.assertNotContains(self.client.get(reverse("publish:feed")), pub.title)


class ReaderTests(Base):
    def setUp(self):
        super().setUp()
        self.pub = self.make(self.paid, kind=Kind.DATASET)
        self.pub.meta = {"rows": 412, "columns": 19,
                         "preview": {"columns": ["_id", "village"], "rows": [["1", "Farafenni"]]}}
        self.pub.mark_published()

    def test_detail_renders_with_the_citation_and_the_plate(self):
        response = self.client.get(self.pub.get_absolute_url())
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, self.pub.citation_key)
        self.assertContains(response, "Cite this")
        self.assertContains(response, "Farafenni")

    def test_detail_carries_open_graph_and_json_ld(self):
        html = self.client.get(self.pub.get_absolute_url()).content.decode()
        self.assertIn('property="og:title"', html)
        self.assertIn('name="twitter:card"', html)
        self.assertIn("application/ld+json", html)
        self.assertIn('"@type": "Dataset"', html)

    def test_a_view_is_counted_once_per_session(self):
        self.client.get(self.pub.get_absolute_url())
        self.client.get(self.pub.get_absolute_url())
        self.pub.refresh_from_db()
        self.assertEqual(self.pub.views_count, 1)

    def test_feed_lists_it(self):
        response = self.client.get(reverse("publish:feed"))
        self.assertContains(response, self.pub.title)

    def test_feed_filters_by_kind(self):
        other = self.make(self.paid, kind=Kind.ARTICLE, title="A written piece")
        other.mark_published()
        response = self.client.get(reverse("publish:feed") + "?kind=dataset")
        self.assertContains(response, self.pub.title)
        self.assertNotContains(response, "A written piece")

    def test_atom_feed(self):
        response = self.client.get(reverse("publish:atom"))
        self.assertEqual(response.status_code, 200)
        self.assertIn(self.pub.title, response.content.decode())

    def test_oembed(self):
        url = "http://testserver" + self.pub.get_absolute_url()
        response = self.client.get(reverse("publish:oembed") + "?url=" + url)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["title"], self.pub.title)
        self.assertIn("iframe", body["html"])

    def test_embed_allows_framing(self):
        response = self.client.get(self.pub.embed_url())
        self.assertEqual(response["X-Frame-Options"], "ALLOWALL")

    def test_embed_is_refused_when_the_author_says_no(self):
        self.pub.allow_embed = False
        self.pub.save()
        self.assertEqual(self.client.get(self.pub.embed_url()).status_code, 404)


class CitationTests(Base):
    def test_apa_has_author_year_title(self):
        pub = self.make(self.paid, title="Water points in the North Bank")
        text = citation.apa(pub, "https://nokknock.app/p/water")
        self.assertIn("Foon, B.", text)
        self.assertIn("Water points in the North Bank", text)
        self.assertIn("KnockKnock", text)

    def test_bibtex_and_ris_download(self):
        pub = self.make(self.paid)
        pub.mark_published()
        for fmt, needle in (("bib", "@article{"), ("ris", "TY  - JOUR")):
            response = self.client.get(reverse("publish:cite", args=[pub.slug, fmt]))
            self.assertEqual(response.status_code, 200)
            self.assertIn(needle, response.content.decode())
            self.assertIn("attachment", response["Content-Disposition"])

    def test_json_ld_dataset_declares_distributions(self):
        pub = self.make(self.paid, kind=Kind.DATASET)
        pub.mark_published()
        doc = citation.json_ld(pub, "https://x/y")
        self.assertEqual(doc["@type"], "Dataset")
        self.assertIn("@misc{", citation.bibtex(pub))
        self.assertIn("TY  - DATA", citation.ris(pub))
        self.assertEqual(doc["identifier"], pub.citation_key)

    def test_two_authors_read_correctly(self):
        pub = self.make(self.paid)
        PublicationAuthor.objects.create(publication=pub, name="Ismaila Jallow", order=1)
        self.assertIn("&", citation.apa(pub))
        self.assertIn(" and ", pub.author_line())


class ShareTests(Base):
    def setUp(self):
        super().setUp()
        self.pub = self.make(self.paid)
        self.pub.mark_published()

    def test_share_link_redirects_to_the_network_and_is_counted(self):
        response = self.client.get(reverse("publish:share", args=[self.pub.slug, "linkedin"]))
        self.assertEqual(response.status_code, 302)
        self.assertIn("linkedin.com", response["Location"])
        self.pub.refresh_from_db()
        self.assertEqual(self.pub.shares_count, 1)
        self.assertEqual(ShareEvent.objects.filter(channel="linkedin").count(), 1)

    def test_copy_link_is_counted_without_a_redirect(self):
        response = self.client.post(reverse("publish:share", args=[self.pub.slug, "link"]))
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])

    def test_a_made_up_channel_is_refused(self):
        self.assertEqual(
            self.client.get(reverse("publish:share", args=[self.pub.slug, "myspace"])).status_code, 404)

    def test_the_shared_url_is_the_canonical_one(self):
        response = self.client.get(reverse("publish:share", args=[self.pub.slug, "x"]))
        self.assertIn("testserver", response["Location"])
        self.assertIn(self.pub.slug, response["Location"])


class EditorTests(Base):
    def test_saving_blocks_numbers_the_figures_and_anchors_the_headings(self):
        pub = self.make(self.paid)
        self.client.force_login(self.paid)
        blocks = [
            {"type": "heading", "text": "How we did it"},
            {"type": "text", "text": "We walked."},
            {"type": "figure", "caption": "Map of the sites"},
            {"type": "figure", "caption": "Second map"},
        ]
        self.client.post(reverse("publish:edit", args=[pub.pk]),
                         {"title": pub.title, "abstract": pub.abstract,
                          "blocks_json": json.dumps(blocks)})
        saved = list(pub.blocks.all())
        self.assertEqual(len(saved), 4)
        self.assertEqual(saved[0].anchor, "how-we-did-it")
        self.assertEqual([b.figure_number for b in saved if b.type == "figure"], [1, 2])

    def test_a_bogus_block_type_is_dropped(self):
        pub = self.make(self.paid)
        self.client.force_login(self.paid)
        self.client.post(reverse("publish:edit", args=[pub.pk]),
                         {"title": pub.title, "blocks_json": json.dumps(
                             [{"type": "script", "text": "alert(1)"}, {"type": "text", "text": "fine"}])})
        self.assertEqual([b.type for b in pub.blocks.all()], ["text"])

    def test_authors_are_replaced_wholesale_and_ordered(self):
        pub = self.make(self.paid)
        self.client.force_login(self.paid)
        self.client.post(reverse("publish:edit", args=[pub.pk]),
                         {"title": pub.title, "authors_json": json.dumps([
                             {"name": "Lamarana Jallow", "affiliation": "Easy Solutions"},
                             {"name": "Ismatou Jallow"},
                         ])})
        self.assertEqual([a.name for a in pub.authors.all()],
                         ["Lamarana Jallow", "Ismatou Jallow"])

    def test_tags_are_deduplicated_and_capped(self):
        pub = self.make(self.paid)
        self.client.force_login(self.paid)
        self.client.post(reverse("publish:edit", args=[pub.pk]),
                         {"title": pub.title, "tags": "Water, water, Health, " + ", ".join(
                             "t%d" % i for i in range(20))})
        self.assertLessEqual(pub.tags.count(), 12)

    def test_title_can_never_be_emptied(self):
        pub = self.make(self.paid)
        self.client.force_login(self.paid)
        self.client.post(reverse("publish:edit", args=[pub.pk]), {"title": "   "})
        pub.refresh_from_db()
        self.assertEqual(pub.title, "Untitled")

    def test_studio_and_new_pages_render(self):
        self.client.force_login(self.paid)
        self.assertEqual(self.client.get(reverse("publish:studio")).status_code, 200)
        self.assertEqual(self.client.get(reverse("publish:new")).status_code, 200)
        self.assertEqual(self.client.get(reverse("publish:new") + "?kind=article").status_code, 200)

    def test_the_editor_page_renders_for_every_kind(self):
        self.client.force_login(self.paid)
        for kind in Kind.values:
            pub = self.make(self.paid, kind=kind, title="Draft %s" % kind)
            PublicationBlock.objects.create(publication=pub, type="text", text="Body", order=0)
            response = self.client.get(reverse("publish:edit", args=[pub.pk]))
            self.assertEqual(response.status_code, 200, kind)
            self.assertContains(response, pub.citation_key)

    def test_the_review_page_renders(self):
        pub = self.make(self.free)
        pub.status = Status.IN_REVIEW
        pub.save()
        self.client.force_login(self.editor)
        response = self.client.get(reverse("publish:review"))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, pub.title)

    def test_the_detail_page_renders_for_every_kind(self):
        for kind in Kind.values:
            pub = self.make(self.paid, kind=kind, title="Live %s" % kind)
            PublicationBlock.objects.create(publication=pub, type="heading", text="Method",
                                            anchor="method", order=0)
            pub.mark_published()
            response = self.client.get(pub.get_absolute_url())
            self.assertEqual(response.status_code, 200, kind)

    def test_starting_an_article_creates_a_draft_with_the_owner_as_author(self):
        self.client.force_login(self.paid)
        response = self.client.post(reverse("publish:new"), {"kind": "article"})
        self.assertEqual(response.status_code, 302)
        pub = Publication.objects.get(owner=self.paid)
        self.assertEqual(pub.status, Status.DRAFT)
        self.assertEqual(pub.authors.count(), 1)


class SlugAndKeyTests(Base):
    def test_slugs_never_collide(self):
        a = self.make(self.paid, title="Same title")
        b = self.make(self.paid, title="Same title")
        self.assertNotEqual(a.slug, b.slug)

    def test_every_publication_gets_a_reference(self):
        pub = self.make(self.paid)
        self.assertTrue(pub.citation_key.startswith("NK-"))
        self.assertNotIn("O", pub.citation_key.split("-")[-1])

    def test_the_reference_survives_a_retitle(self):
        pub = self.make(self.paid)
        key, slug = pub.citation_key, pub.slug
        pub.title = "A completely different title"
        pub.save()
        self.assertEqual(pub.citation_key, key)
        self.assertEqual(pub.slug, slug)


class AdapterTests(TestCase):
    def test_every_kind_has_an_adapter(self):
        for kind in Kind.values:
            self.assertIsNotNone(sources.adapter_for(kind), kind)

    def test_the_article_adapter_needs_no_source_app(self):
        self.assertTrue(sources.adapter_for("article").available())

    def test_adapters_with_a_missing_app_are_not_offered(self):
        # hanns / kura / chalk / cards are not installed in the test project.
        offered = {a.kind for a in sources.available_adapters()}
        self.assertIn("article", offered)
        self.assertNotIn("deck", offered)

    @override_settings(PUBLISH_SOURCE_MODELS={"deck": "nope.NotAModel"})
    def test_a_bad_model_path_degrades_instead_of_raising(self):
        self.assertFalse(sources.adapter_for("deck").available())
        self.assertEqual(sources.adapter_for("deck").list_for_user(None), [])

    def test_the_board_renderer_turns_strokes_into_svg(self):
        adapter = sources.adapter_for("board")

        class Page:
            surface = "black"
            strokes = [{"p": [0.1, 0.1, 0.5, 0.5, 0.9, 0.2], "c": "#ff0", "w": 0.01}]
            els = [{"type": "text", "x": 0.2, "y": 0.6, "text": "E = mc<2>", "size": 0.05}]

        class Board:
            surface = "black"

        svg = adapter.page_svg(Board(), Page())
        self.assertTrue(svg.startswith("<svg"))
        self.assertIn("<path", svg)
        self.assertIn("stroke=\"#ff0\"", svg)
        self.assertIn("E = mc&lt;2&gt;", svg)      # escaped, not injected
        self.assertIn("#12130f", svg)

    def test_the_board_renderer_ignores_a_stroke_with_no_points(self):
        adapter = sources.adapter_for("board")

        class Page:
            surface = "white"
            strokes = [{"p": []}, {"p": [0.1]}]
            els = []

        svg = adapter.page_svg(object(), Page())
        self.assertNotIn("<path", svg)

    def test_the_dataset_flattener_handles_lists_and_dicts(self):
        flatten = sources.adapter_for("dataset")._flatten
        self.assertEqual(flatten(None), "")
        self.assertEqual(flatten(["a", "b"]), "a b")
        self.assertEqual(flatten({"x": 1}), '{"x": 1}')
        self.assertIn("[{", flatten([{"n": 1}]))


class HomeStripTests(Base):
    def test_home_helper_returns_only_live_work_featured_first(self):
        from .views import home_publications
        a = self.make(self.paid, title="Ordinary")
        a.mark_published()
        b = self.make(self.paid, title="Featured one")
        b.mark_published()
        b.featured = True
        b.save()
        self.make(self.paid, title="Still a draft")
        rows = home_publications(limit=5)
        self.assertEqual(rows[0].title, "Featured one")
        self.assertEqual(len(rows), 2)


class OgImageTests(Base):
    def test_og_image_renders_a_png(self):
        from . import ogimage
        pub = self.make(self.paid, kind=Kind.DATASET)
        pub.meta = {"rows": 1200, "variables": 34}
        data = ogimage.render(pub)
        self.assertTrue(data.startswith(b"\x89PNG"))
        self.assertGreater(len(data), 3000)

    def test_og_endpoint_serves_something(self):
        pub = self.make(self.paid)
        pub.mark_published()
        response = self.client.get(reverse("publish:og", args=[pub.slug]))
        self.assertIn(response.status_code, (200, 302))


class TemplateFilterTests(TestCase):
    def test_richtext_escapes_then_marks_up(self):
        from .templatetags.publish_extras import richtext, tsv_rows, compact
        out = str(richtext("<script>x</script> **bold** and *slanted*"))
        self.assertIn("&lt;script&gt;", out)
        self.assertIn("<strong>bold</strong>", out)
        self.assertIn("<em>slanted</em>", out)
        self.assertNotIn("<script>", out)

    def test_richtext_links_only_http(self):
        from .templatetags.publish_extras import richtext
        out = str(richtext("[click](javascript:alert(1)) [ok](https://a.example/b)"))
        self.assertNotIn('href="javascript', out)
        self.assertNotIn("<a href=\"javascript", out)
        self.assertIn('href="https://a.example/b"', out)

    def test_tsv_rows_splits_tabs_and_pipes(self):
        from .templatetags.publish_extras import tsv_rows
        self.assertEqual(tsv_rows("a\tb\nc\td"), [["a", "b"], ["c", "d"]])
        self.assertEqual(tsv_rows("a | b"), [["a", "b"]])

    def test_compact_numbers(self):
        from .templatetags.publish_extras import compact
        self.assertEqual(compact(940), "940")
        self.assertEqual(compact(1200), "1.2k")
        self.assertEqual(compact(2000000), "2m")
