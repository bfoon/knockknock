# Knock-Knock polls — advanced question types

This drop overhauls the `polls` app with 15 new question types, a richer
chart system, per-question flexibility settings, and branching/skip logic.

## What's new

**Question types** — now 20 total:

| Group | Types |
|---|---|
| Choice | `mcq`, `image_choice`, `yes_no` |
| Scale & rating | `scale`, `rating`, `nps`, `likert`, `slider` |
| Open input | `open`, `word`, `numeric`, `file_upload` |
| Ranking & distribution | `ranking`, `matrix`, `points_allocation` |
| Date & time | `date`, `datetime`, `time` |
| Spatial & visual | `pin_image`, `pin_map`, `two_by_two` |
| Live & reaction | `reaction` (ephemeral, Redis-only) |

**Per-question flexibility** — every question can now set:

- Time limit in seconds (or none)
- Required vs skippable
- Anonymous vs identified (stores nickname when off)
- Min/max selections (MCQ + image_choice)
- Template override (use a different template just for this slide)
- Skip / branch rules (jump to question N if answer matches)

**Charts** — curated set per question type, with a "show all" toggle for
overrides. Defined in `polls/charts.py`.

## Files in this drop

```
polls/
  models.py             (replaces)  — extended + 3 new tables
  forms.py              (replaces)  — per-type config forms
  views.py              (replaces)  — type-aware editor
  urls.py               (replaces)  — adds change_type
  charts.py             (new)       — chart registry
  question_types.py     (new)       — type metadata registry
  migrations/
    0002_advanced_question_types.py — reference migration

templates/polls/
  question_edit.html    (replaces)  — biggest change; type picker + dynamic UI
  partials/qtypes/
    _choices.html       (new)       — used by all has_choices types
    qtype_matrix.html   (new)
    qtype_pin_image.html(new)
    qtype_pin_map.html  (new)
    qtype_two_by_two.html(new)
```

Templates not in this drop (your existing ones still work):
`list.html`, `create.html`, `edit.html`, `results.html`,
`partials/template_picker.html`.

## Installing

1. Replace each file at the same relative path in your project.
2. **Re-generate the migration** (recommended over using the included one):
   ```bash
   python manage.py makemigrations polls --name advanced_question_types
   python manage.py migrate polls
   ```
   The included `0002_advanced_question_types.py` is a reference; Django's
   own generator handles the exact baseline dependency for you.
3. No data migration needed — existing questions remain valid `mcq`/`word`/
   `scale`/`open`/`ranking` types with empty `config={}` and `skip_rules=[]`.

## Storage layout

| Type group | Storage shape |
|---|---|
| `mcq`, `image_choice`, `yes_no`, `likert`, `reaction` | `Response.choice` (FK to `Choice`) |
| `mcq`/`image_choice` with `max_selections>1` | Multiple `Response` rows per (participant, question) |
| `scale`, `rating`, `nps`, `slider`, `numeric` | `Response.numeric_value` |
| `word`, `open` | `Response.text_value` |
| `date`, `datetime`, `time` | `Response.datetime_value` (time-only uses 1970-01-01) |
| `file_upload` | `Response.file_value` |
| `pin_image`, `pin_map`, `two_by_two` | `Response.x_value` + `Response.y_value` |
| `matrix` | `MatrixAnswer` (one row per sub-row) |
| `points_allocation` | `PointsAllocation` (one row per choice) |
| `ranking` | Multiple `Response` rows ordered by `Response.created_at` |
| `reaction` | Ephemeral — not persisted to DB (Redis only) |

## What's NOT in this drop

- **Participant-side rendering.** The editor is fully wired but the
  participant's answer screens for new types (pin-on-map UI, 2×2 grid
  placement, file uploader, etc.) need their own templates. I built the
  data layer and editor; the participant flow is its own milestone.
- **Live chart renderers.** New charts like `heatmap`, `scatter`,
  `nps_segments`, `split_card` are registered but their JS renderers
  need to be wired into your existing live-chart system.
- **Results page + Excel/Word export.** Stubbed — the existing exports
  will need updating to read from the new fields and tables.
- **`games` app.** Per your earlier "polls only for now" choice.

## Branching rules format

`Question.skip_rules` is a JSON list. Each entry has:
- `if_choice_id` (int) — match when this Choice is picked, OR
- `if_value_min` + `if_value_max` (floats) — match when numeric answer is in range
- `jump_to_order` (int) — order index of the question to jump to

The participant flow evaluates rules top-to-bottom; first match wins.
If no rule matches, the participant proceeds linearly.

Example:
```json
[
  {"if_value_min": 0, "if_value_max": 6, "jump_to_order": 5},
  {"if_choice_id": 42, "jump_to_order": 9}
]
```

## Adding more question types later

1. Add an entry to `QUESTION_TYPE_REGISTRY` in `polls/question_types.py`
2. Add the type's curated chart list to `CHART_CHOICES_BY_TYPE` in `polls/charts.py`
3. (If type-specific config needed) Add a Form class to `polls/forms.py`
   and register it in `CONFIG_FORM_BY_TYPE`
4. (Optional) Add a `qtype_<id>.html` partial under `templates/polls/partials/qtypes/`
   and reference it from `question_edit.html`
