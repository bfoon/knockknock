# Kura — the Knock-Knock survey lifecycle studio

One Django app covering the whole survey life cycle:

    BUILD → PUBLISH → COLLECT (web + offline mobile) → CLEAN → PRESENT (Hanns deck)

Everything follows your existing Hanns/Boardly conventions: owner + short
join code, JSON payloads for fast-moving editor data, `ORDERING MATTERS`
url style, and the Knock-Knock glassy gradient visual language.

## What's in the box

| File | Purpose |
|---|---|
| `models.py` | Survey, versioned FormVersion snapshots, Submission (with client UUID idempotency key), AnswerEdit audit trail, CleaningRule/SubmissionFlag, Device tokens, SyncLog |
| `logic.py` | The logic engine: structured AND/OR skip logic (nestable), safe AST-based calculations, `${piping}`, full server-side validation |
| `cleaning.py` | Cleaning engine: duplicates, IQR/z-score outliers, speeders, straight-liners, GPS geofence, missing-critical, custom logic checks, recodes — all audited |
| `api.py` | Token-authenticated mobile sync API (offline-first, idempotent batch push) |
| `views.py` | Builder, publish, web runner, data workbench, CSV export, Hanns export |
| `hanns_export.py` | Turns results into a real Hanns deck (title, overview, per-question chart slides) |
| `live.py` / `consumers.py` / `routing.py` | Live monitor: fail-safe broadcast helper, owner-only WebSocket consumer, Channels route |
| `templates/kura/` | `survey_list`, `builder` (studio), `collect` (public runner), `data` (cleaning workbench), `monitor` (live source map + feed), `map` (full-screen live map) |
| `migrations/0001_initial.py` | Generated and tested against sqlite |

## Wiring (3 steps)

1. Copy the `kura/` folder next to `hanns/` and add to settings:

   ```python
   INSTALLED_APPS = [..., "kura"]
   ```

2. Root `urls.py`:

   ```python
   path("kura/", include("kura.urls", namespace="kura")),
   ```

3. Migrate:

   ```bash
   python manage.py migrate kura
   ```

No new pip requirements — plain Django, no DRF. No Channels routes needed
(collection is HTTP; live-results-over-WebSocket can be added later using
the same `PresentConsumer` pattern you already have).

The list template links to `{% url 'core:dashboard' %}` like your Hanns
pages — adjust if your dashboard route is named differently.

## Why the logic beats Kobo/XLSForm

* **Structured conditions, not XPath strings.** Skip logic is JSON
  (`{"op":"and","rules":[…]}`), built visually, nestable to any depth
  (groups of groups), and evaluated with *identical semantics* in Python
  (`kura/logic.py`) and JS (the runner) — so the server re-validates every
  submission and drops answers to questions the respondent couldn't have
  seen.
* Comparators Kobo makes painful are first-class: `selected/not_selected`
  on multi-selects, `between`, `in`, `matches` (regex), `answered`.
* **Calculated questions** with a safe expression grammar
  (`weight / ((height/100)^2)`, `if_`, `coalesce`, `count`, …) — evaluated
  on device for live piping and *re-computed on the server*, so clients
  can't forge them.
* **Piping** (`${name}` in any label/hint), per-respondent **choice
  shuffling**, per-choice **scoring**, regex/min/max validation with custom
  messages, response **quotas**, and **form versioning**: every submission
  records the exact published version it answered.

## The web runner

`/kura/<CODE>/` is public (put it in a QR like Hanns join links). Live skip
logic, piping, progress bar, star ratings, ranking, GPS capture, and a
client UUID so an accidental double-tap can't double-submit.

## Data cleaning workbench

`/kura/<CODE>/data/` — live grid of every response with:

* one-click **Run cleaning** across all enabled rules (rules re-baseline
  each run, so fixed rows un-flag themselves and heal back to `complete`);
* inline **cell editing** — every change stores the old value, editor and
  reason in `AnswerEdit` (nothing is ever silently overwritten);
* row status control (`complete/partial/flagged/excluded` — excluded rows
  stay in the DB and are only dropped from exports/decks);
* **CSV export** (`?all=1` to include excluded rows);
* **✨ Create Hanns deck** — builds a results presentation and opens it in
  the Hanns editor.

## Live monitor — see where data comes from, as it lands

`/kura/<CODE>/monitor/` (linked from the builder, data page and survey
list) shows, for the survey owner only:

* a **map** of every GPS-tagged response — cyan dots came through the
  public web link, pink dots from the mobile app, click any dot for the
  device, enumerator, version and time;
* a **live feed** where each web submission, each app submission and each
  device **sync exchange** (new / duplicate / rejected counts) appears the
  instant the server stores it;
* per-source counters (total, last hour, today, web vs app, with-GPS);
* a **devices & enumerators** panel (last seen, per-survey push count) and
  the full **sync history** table.

**Full-screen live map** — `/kura/<CODE>/map/` (linked from the monitor
and data pages) is a projector-ready view for ops rooms: dark map tiles,
new responses ripple in live (cyan = web link, pink = mobile app), an
arrivals ticker, a heat-map toggle (H), follow-new-arrivals (P), fit-all
and fullscreen (F). Same owner-only auth and the same WS/polling transport
as the monitor.

Transport: WebSocket first (`ws/kura/<CODE>/monitor/`, owner-authenticated
in the consumer), with automatic fallback to polling
`/kura/<CODE>/monitor/feed/?since=<ISO>` every 6 s if Channels isn't wired
or the socket drops — so the page works even before you touch asgi.py.
Broadcasting is fail-safe: if the channel layer is missing or down,
collection continues untouched.

ASGI wiring (same pattern as Hanns):

```python
import boardly.routing, hanns.routing, kura.routing
websocket_urlpatterns = (
    boardly.routing.websocket_urlpatterns
    + hanns.routing.websocket_urlpatterns
    + kura.routing.websocket_urlpatterns
)
```

## Presenting on Hanns

`hanns_export.py` writes real `hanns.Deck`/`Slide` rows using the slide
shape documented in `hanns/models.py` (`{bg,bgSize,bgFx,transition,els}`).
One thing to check on your side: the element `type` strings must match what
`hanns_core.js` renders. The exporter uses `"text"` and `"chart"` — if your
renderer names them differently, change only the `TEXT_TYPE`/`CHART_TYPE`
constants (and, if needed, the key names inside `_text()`/`_chart()`) at
the top of `hanns_export.py`.

## Mobile sync API (offline / online)

Token auth: `Authorization: Token <64-hex>`. Full protocol notes are in the
`api.py` docstring; summary for the app developer:

### 1 · Register the device (once, online)

```
POST /kura/api/devices/register/
{"username":"enum1","password":"…","device_name":"Tecno Spark","platform":"android"}
→ {"ok":true,"token":"…","device_id":7}
```

### 2 · Pull forms whenever online

```
GET /kura/api/forms/                → manifest: every collectable survey with
                                       version + schema_hash (download only
                                       versions the phone doesn't cache)
GET /kura/api/forms/<CODE>/         → full schema for offline caching
```

### 3 · Collect offline

Render the cached schema; the condition JSON and calc expressions are
trivial to evaluate on-device (the runner in `collect.html` is a working
reference implementation in ~120 lines of JS). Store each interview locally
with a client-generated **UUIDv4** and the **version** it was collected
against.

### 4 · Push when connectivity returns (idempotent)

```
POST /kura/api/forms/<CODE>/sync/
{"submissions":[
  {"uuid":"…","version":3,"answers":{…},"status":"complete",
   "gps":[13.4531,-16.5790],"started_at":"…","submitted_at":"…","duration_ms":240000},
  …up to 200 per batch
]}
→ {"ok":true,"created":2,"duplicates":0,"rejected":0,
   "current_version":3,
   "results":[{"uuid":"…","result":"created","id":91,"validation_errors":null}, …]}
```

Sync rules for the app:

* Delete a local row **only** when its UUID comes back `created` or
  `duplicate` — re-sending a whole batch after a dropped connection is
  always safe (verified in tests).
* If `current_version` in the response is newer than the cached form,
  re-pull the schema.
* Server-side validation runs on every pushed item; items with errors are
  still stored (as `partial`, raw answers preserved) with the errors
  reported back, so field data is never lost to a validation dispute.

## Tested

Shipped after passing, on sqlite: the logic-engine assertion suite
(conditions, calc sandbox incl. injection block, piping, relevance-aware
validation/scoring), the cleaning engine (outlier/duplicate/speeder
detection + healing), the full API round trip (register → manifest → pull →
push → **idempotent re-push** → server-enforced skip logic), the web-runner
submit path incl. 422 field errors, and deck assembly against a stubbed
Hanns app.



## Calculation superpowers (beyond XLSForm)

The expression engine (identical in the runner and on the server) now
drives far more than hidden values:

**Expression-driven repeats** — `repeat.count_expr` fixes the exact item
count from any answer or calc (`hh_size` → one card per member,
auto-added/removed, add/remove buttons hidden); `repeat.min_expr` /
`max_expr` set dynamic bounds (`plots * 2`). Static and expression
bounds combine — the stricter wins.

**Dynamic validation** — numeric questions accept `validate.min_expr` /
`max_expr` (e.g. children in school ≤ `count_if(members,"age","lt",18)`),
and every answerable question accepts `validate.expr`, a constraint that
must hold, with `value` bound to the current answer
(`value <= hh_size * 5000`). Inside repeats, expressions see the current
item's siblings first.

**Soft warnings** — `validate.warn_expr` + `warn_message` flag
implausible answers in amber as the respondent types, without ever
blocking submission (plausibility checks Kobo/ODK can't express).

**Live visible calcs** — tick "Show the result live" on a `calculate`
and the runner displays the updating value read-only (BMI, totals,
running scores). Calc names also pipe into any label/hint via `${name}`.

**Repeat aggregates** — `sum_of(group,"col")`, `avg_of`, `min_of`,
`max_of`, `count_if(group,"col","lt",18)` and `count(group)` operate on
repeat answers directly — no `indexed-repeat()` gymnastics. The server
recomputes aggregate calcs over the *cleaned* items. Boolean operators
`and` / `or` / `not` and comparisons work everywhere expressions do:
calc fields, constraints, bounds, and repeat counts.

## Live preview, QR scanning & lookup datasets

**Live draft preview** — the builder's Preview button now opens
`/kura/<CODE>/preview/` (owner-only): the runner rendered from the
**draft** schema, so skip logic, geofencing, cascades and repeats are
testable *before any publish*. The page re-pulls the draft whenever the
tab regains focus (builder autosaves within a second) and has a ↻
Refresh button. Submitting in preview runs full server validation but
stores nothing. The public link (`/kura/<CODE>/`) still serves only the
published version — respondents never see the draft.

**Camera scanning** — `barcode` questions render a 📷 Scan button that
opens the device camera (html5-qrcode, loaded on demand; requires HTTPS)
and reads QR, EAN, Code-128 and other common symbologies straight into
the answer.

**Lookup datasets (scan-to-search / follow-ups)** — upload CSVs in the
builder's left column (header row required; first column is the match
key by default; ≤20k rows; re-uploading a name replaces it). Link a
barcode question to a dataset in the inspector, and the runner matches
the scanned/typed code against the key (exact, case-insensitive), shows
the record card, and can **auto-fill other answers** from mapped columns
— e.g. scan a round-1 participant ID and pull name/village/baseline into
the follow-up form. The public endpoint only returns exact-key matches
(no listing/browsing), and only while the survey is collecting.
Mobile apps pull full datasets from
`GET /kura/api/forms/<CODE>/lookups/` (token auth) to match offline.

## Advanced form features (v2 engine)

**Repeat groups** — question type `repeat` holds child questions that
respondents fill once per item (household members, plots, assets…).
Configure min/max items and an item label (`Member ${index}`, or pipe a
child answer like `${mname}`). Children support everything ordinary
questions do — skip logic (the current item's answers are checked first,
then the outer form), validation, scoring, cascading, geofencing — plus
per-item `calculate` fields. Answers are stored as a list of objects;
errors come back keyed `group.<index>.<child>`; CSV export serialises the
group as JSON in its column; the Hanns export skips repeat internals.

**Geofence zones** — define named areas in the builder's left column:
circles (`lat/lng/radius_km`) or polygons (JSON list of `[lat,lng]`
points), stored in `schema.zones`.

**Geofenced questions** — any question can be shown only *inside* or
*outside* selected zones, with a fallback (show/hide) when the
respondent's location is unknown. The web runner auto-requests GPS when a
form uses geo features and shows a small location banner.

**Cascading selects** — a choice question can filter its options by an
earlier choice answer (`cascade.parent`); each choice carries a `parent`
value. Works at the top level and inside repeat items.

**Geo-filtered choice lists** — individual choices can carry `zones`, so
the option only appears when the respondent is inside one of them; this
stacks with cascading (e.g. only the districts of the selected region
*that exist around the respondent*). `geo_choice_fallback` controls
whether zone-limited choices appear before GPS is available.

All of it is enforced twice: live in the runner, and authoritatively in
`logic.validate_submission(schema, answers, gps=…)` — both intake paths
(web submit and the mobile sync API) pass the submission GPS in, so a
tampered client cannot answer a geofenced question from the wrong place
or pick a choice its location/parent answer would have hidden.
