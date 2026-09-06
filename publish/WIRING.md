# Wiring `publish` into KnockKnock

Six steps, then a section of things I had to guess.

## 1. Drop the app in

Copy the `publish/` folder next to `hanns/`, `kura/`, `chalk/` and `core/`.

## 2. settings.py

```python
INSTALLED_APPS = [
    ...
    "publish",
]

# --- publications -------------------------------------------------------
PUBLISH_SITE_URL = "https://nokknock.app"        # used when there is no request
PUBLISH_BASE_TEMPLATE = "publish/base.html"      # see note 6 below
PUBLISH_INSTANT_FOR_STAFF = True
PUBLISH_MAX_IMAGE_BYTES = 8 * 1024 * 1024
PUBLISH_MAX_ROWS = 200000
```

## 3. urls.py

```python
path("p/", include("publish.urls")),
```

`/p/` is deliberately short: it is the address people will paste into reports
and it should still fit on a QR code and a business card.

## 4. Migrate

```bash
python manage.py makemigrations publish   # 0001_initial is already included
python manage.py migrate publish
```

## 5. Home page

`core/views.py`:

```python
from publish.views import home_publications

# inside the home view's context
"publications": home_publications(limit=6),
```

`core/home.html`, wherever the strip should sit:

```django
{% include "publish/partials/_home_strip.html" %}
```

The partial styles itself from `publish.css`, so add this to the `<head>` of
`base.html` (or just to `home.html`):

```django
<link rel="stylesheet" href="{% static 'publish/css/publish.css' %}?v=1">
```

Nav link in `base.html` and the mobile drawer:

```django
<a class="nav-link" href="{% url 'publish:feed' %}">Publications</a>
```

## 6. The plan gate

This is the only part that must be pointed at your real subscription model.
`publish/plans.py` never imports `subscriptions`; it duck-types and falls back
to "free", which means **today every user is treated as free and goes through
review**. Once you tell it where the plan code lives:

```python
PUBLISH_PLAN_RESOLVER = "subscriptions.helpers.plan_code_for"   # callable(user) -> "free" | "pro" | ...
PUBLISH_INSTANT_PLANS = ["pro", "team", "school", "enterprise"]
```

The resolver is a plain function taking a user and returning a string.

---

# Things I had to guess

I do not have `hanns/models.py`, `kura/models.py`, `chalk/models.py` or the
cards app in front of me, so every source adapter resolves its model through a
setting and reports itself unavailable rather than crashing when the guess is
wrong. **An adapter that cannot resolve simply does not appear in the "publish
something" list**, which is how you will spot a wrong guess.

Confirm or correct these in settings:

```python
PUBLISH_SOURCE_MODELS = {
    "deck":    "hanns.Deck",         # confident — memory of the Hanns build
    "dataset": "kura.Survey",        # confident
    "board":   "chalk.Board",        # confident
    "card":    "cards.Card",         # GUESS — app label and model name both
    "show":    "attendance.Event",   # GUESS — "show" was the vaguest of the six
}
```

Three more specifics:

**Hanns exporters.** The deck adapter looks for an HTML exporter and a PPTX
exporter by dotted path, trying `hanns.html_exporter.export_deck`,
`.build_html`, `.export` and the equivalents for pptx. If your function is
named something else:

```python
PUBLISH_HANNS_HTML_EXPORT = "hanns.html_exporter.<your function>"   # (deck) -> str
PUBLISH_HANNS_PPTX_EXPORT = "hanns.pptx_exporter.<your function>"   # (deck) -> bytes
```

If neither resolves, a deck still publishes — it just has no player and no
download, which is worth catching early.

**Kura.** `DatasetAdapter` reads the questionnaire from
`survey.questions / .schema / .definition / .form / .items` (list of dicts) and
falls back to `survey.current_version`. Rows come from `survey.submissions`,
answers from `submission.clean_data` or `.data` or `.answers`. If Kura stores
its answers somewhere else, the CSV will come out with only `_id` and
`_submitted_at` — that is the symptom to look for. The clean/raw split tries
`is_clean` / `cleaned`, then falls back to excluding rows with unresolved
flags.

**Chalk.** The SVG renderer reads `page.strokes` as a list of dicts with `p`
(flat 0–1 coordinate pairs), `c`, `w`, `o`, and `page.els`. That matches what
we built in Pass 1, but I have still never seen `chalk_stage.js`, so if the
stored key names drifted, the boards will publish as blank pages.

**"Show".** Of the six kinds this is the one I am least sure I read correctly.
Right now it publishes a record of a live session: title, times, venue,
attendee count, and whatever list relations it finds. If you meant a Hanns live
show, or the polling platform, say so and I will rewrite the adapter — it is
about forty lines and nothing else changes.

---

# Optional dependencies

Everything degrades quietly if these are missing.

| Package | Gives you | Without it |
|---|---|---|
| `Pillow` | the generated link-preview image | falls back to the cover photo or nothing |
| `openpyxl` | the Excel copy of a dataset | CSV only |
| `qrcode` or `segno` | the QR button on the share panel | button 404s |

`Pillow` you already have. Check the other two:

```bash
pip install openpyxl qrcode
```

---

# Two things worth knowing about the design

**Frozen assets.** Pressing publish writes real files and sha256s them. The
publication reads from those files afterwards, never from the live deck or
survey. Editing the source later changes nothing until you press *Start version
2*, and version 1 keeps its files, its checksums and its address. This is the
reason the app exists and it is the one behaviour not to optimise away.

**Nothing is stripped from a dataset.** You chose publish-exactly-as-selected,
so a raw Kura release goes out with its GPS columns, device IDs and enumerator
names intact. The picker and the editor both say so in plain words, but there
is no server-side guard. If you later want a warning that counts GPS-looking
columns before release, that is a small addition to `DatasetAdapter.frame` and
I would recommend it.
