# publish — KnockKnock Publications

Publish a Kura dataset, a Hanns deck, a Chalk board, a card, a show or an
article to a permanent, citable page, and share it anywhere.

Mounted at `/p/`. See `WIRING.md` for installation and for the list of
assumptions that need your confirmation.

## What Pass 1 does

**All six kinds work end to end.** Pick a thing → fill in the metadata →
publish. Free plans go to a review queue, paid plans go live immediately.

**Every release is frozen.** Publishing writes real files, checksums them with
sha256 and records a version snapshot. The published page reads from those
files. Editing the source deck or re-cleaning the survey afterwards changes
nothing until you deliberately start version 2, and version 1 keeps its files
and its URL. A reader who cited it can still get exactly what they cited.

**Datasets bring their own codebook.** Because Kura owns the questionnaire, the
adapter can emit a variable dictionary — name, label, type, choice lists, skip
condition — as JSON and CSV alongside the data, and a second sheet in the Excel
copy. Most data portals cannot do this and it is the single biggest reason a
release here reads as more serious than one on a generic platform.

**Machines can read it.** `schema.org/Dataset` and `schema.org/Article` JSON-LD,
an oEmbed endpoint, an Atom feed, canonical URLs, and a server-rendered
1200×630 link-preview image drawn from the title, authors and reference number
so a link posted to LinkedIn looks deliberate even with no cover photo.

**Citation is one click.** Reference, BibTeX and RIS, all against a permanent
address and a short reference key like `NK-2026-K4TQZ`.

**Sharing is tracked.** X, LinkedIn, Facebook, WhatsApp, Telegram, email, copy
link, embed code, QR code, and the device share sheet on phones. Each records a
`ShareEvent` so you can see which channel actually moves a publication.

## Files

```
publish/
  models.py            Publication, authors, blocks, assets, versions, review, metrics
  plans.py             free = reviewed, paid = instant; never imports subscriptions
  sources.py           one adapter per kind; no hard imports of hanns/kura/chalk/cards
  assets.py            the freeze pipeline
  citation.py          APA / BibTeX / RIS / JSON-LD
  ogimage.py           the link-preview image
  feeds.py             Atom
  views.py urls.py admin.py apps.py
  templatetags/publish_extras.py
  migrations/0001_initial.py
  templates/publish/   base, feed, detail, embed, studio, new, edit, review, partials
  static/publish/      publish.css, publish_reader.js, publish_editor.js
  tests.py             60 tests
  README.md WIRING.md
```

## Design notes

The reading pages use their own type and colour rather than the `kk-*` system:
Newsreader for anything you read, IBM Plex Sans for anything you operate, on a
cool paper ground with a deep green seal. A publication should not look like
another tool screen.

The left margin of a publication carries a plate — reference key, version,
licence, coverage, what it was made from. That is the element doing the work of
making a CSV from a field survey look like a record rather than an attachment.

Article bodies are stored as ordered blocks, not one HTML field, which is what
gives you real figure numbering, a table of contents built from actual
headings, and a print stylesheet that behaves. Paragraph text takes a small,
deliberately limited inline markup (bold, italic, code, http links) that is
escaped first, so a paste out of Word cannot inject anything.

## Tests

60 tests, all passing on Django 6.1:

```bash
python manage.py test publish
```

They cover the plan gate in both directions, the review queue, permissions,
draft and unlisted visibility, versioning, the frozen-asset contract, all four
citation formats, share tracking and redirects, oEmbed, Atom, the embed card,
block sanitisation (a `script` block type is dropped, a `javascript:` link
never becomes an href), the Chalk stroke-to-SVG renderer including XML escaping,
adapter degradation when an app is missing, and a render check on the detail
and editor pages for every one of the six kinds.

## Not in Pass 1

- **Comments and reactions.** No models yet. Straightforward to add.
- **Collections and series.** Grouping several releases under one banner.
- **An author dashboard.** `MetricDay` and `ShareEvent` are being recorded but
  nothing draws them yet; a small chart on the studio page is the obvious next
  step and needs no new data.
- **Celery.** Freezing runs inline. A 200k-row survey will make the publish
  request slow. `assets.freeze()` is a single function and moving it behind a
  task is a ten-line change once you decide it hurts.
- **Full-text search.** The index search is `icontains`. Postgres
  `SearchVector` would be better and you are already on Postgres.
- **A redaction warning.** You chose publish-exactly-as-selected, so nothing is
  stripped. A non-blocking "this file has 3 GPS columns and a phone number
  column" notice before release would fit the choice without overriding it.
