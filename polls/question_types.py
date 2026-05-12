"""
Central registry of every question type Knock-Knock supports.

Each entry tells the rest of the app:
  - what storage shape the answer uses (single/choice/datetime/file/coords/matrix/points/ephemeral)
  - whether it has choices (and if so, whether choices need images)
  - which extra editor fields to show
  - which charts are valid (the curated default set — see polls.charts for full lists)
  - participant-side renderer name (for the live answer screen)

Adding a new type? Add an entry here, add a curated chart list in polls.charts,
and add a `qtype_<id>.html` editor partial.
"""

# Storage shapes — keep these in sync with Response/MatrixAnswer/PointsAllocation
STORAGE_CHOICE       = "choice"        # uses Response.choice (existing)
STORAGE_NUMERIC      = "numeric"       # uses Response.numeric_value
STORAGE_TEXT         = "text"          # uses Response.text_value
STORAGE_DATETIME     = "datetime"      # uses Response.datetime_value
STORAGE_FILE         = "file"          # uses Response.file_value
STORAGE_COORDINATE   = "coordinate"    # uses Response.x_value + y_value
STORAGE_MATRIX       = "matrix"        # uses MatrixAnswer rows
STORAGE_POINTS       = "points"        # uses PointsAllocation rows
STORAGE_EPHEMERAL    = "ephemeral"     # not persisted to DB (Redis-only)
STORAGE_MULTI_CHOICE = "multi_choice"  # uses Response.choice but allows multiple rows
STORAGE_NONE         = "none"          # static slide — no participant input expected


# Logical groupings for the picker UI
GROUP_CHOICE      = "Choice"
GROUP_SCALE       = "Scale & rating"
GROUP_OPEN        = "Open input"
GROUP_RANKING     = "Ranking & distribution"
GROUP_TIME        = "Date & time"
GROUP_SPATIAL     = "Spatial & visual"
GROUP_LIVE        = "Live & reaction"
GROUP_STATIC      = "Slides"


QUESTION_TYPE_REGISTRY = {
    # ── Existing 5 ──────────────────────────────────
    "mcq": dict(
        label="Multiple Choice", icon="✅", group=GROUP_CHOICE,
        storage=STORAGE_CHOICE, has_choices=True, choices_need_image=False,
        default_chart="bar",
        description="One or more options. Classic.",
        supports_min_max_selections=True,
    ),
    "word": dict(
        label="Word Cloud", icon="☁️", group=GROUP_OPEN,
        storage=STORAGE_TEXT, has_choices=False, choices_need_image=False,
        default_chart="wordcloud",
        description="One- or two-word answers, rendered as a cloud.",
    ),
    "scale": dict(
        label="Scale", icon="🌡️", group=GROUP_SCALE,
        storage=STORAGE_NUMERIC, has_choices=False, choices_need_image=False,
        default_chart="histogram",
        description="Numeric scale. Defaults to 1–10, but can be limited to 1–5 or any range up to 10.",
        scale_min=1, scale_max=10,
    ),
    "open": dict(
        label="Open Text", icon="📝", group=GROUP_OPEN,
        storage=STORAGE_TEXT, has_choices=False, choices_need_image=False,
        default_chart="responses_list",
        description="Long-form text answers.",
    ),
    "ranking": dict(
        label="Ranking", icon="🥇", group=GROUP_RANKING,
        storage=STORAGE_MULTI_CHOICE, has_choices=True, choices_need_image=False,
        default_chart="ranked_bar",
        description="Drag to order. Highest-ranked wins.",
    ),

    # ── New: Scale & rating ─────────────────────────
    "rating": dict(
        label="Star Rating", icon="⭐", group=GROUP_SCALE,
        storage=STORAGE_NUMERIC, has_choices=False, choices_need_image=False,
        default_chart="avg_marker",
        description="1–5 (or 1–10) stars.",
        scale_min=1, scale_max=5,
    ),
    "nps": dict(
        label="NPS (0–10)", icon="📊", group=GROUP_SCALE,
        storage=STORAGE_NUMERIC, has_choices=False, choices_need_image=False,
        default_chart="nps_segments",
        description="Net Promoter Score — detractors / passives / promoters.",
        scale_min=0, scale_max=10,
    ),
    "yes_no": dict(
        label="Yes / No", icon="🟢", group=GROUP_CHOICE,
        storage=STORAGE_CHOICE, has_choices=True, choices_need_image=False,
        default_chart="split_card",
        description="A fast binary question. Choices are auto-created.",
        auto_choices=["Yes", "No"],
    ),
    "likert": dict(
        label="Likert scale", icon="📏", group=GROUP_SCALE,
        storage=STORAGE_CHOICE, has_choices=True, choices_need_image=False,
        default_chart="stacked_bar",
        description="Strongly disagree → Strongly agree (5- or 7-point).",
        auto_choices=[
            "Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree",
        ],
    ),
    "slider": dict(
        label="Slider", icon="🎚️", group=GROUP_SCALE,
        storage=STORAGE_NUMERIC, has_choices=False, choices_need_image=False,
        default_chart="distribution",
        description="Continuous numeric range (set min/max in settings).",
        scale_min=0, scale_max=100,
    ),
    "numeric": dict(
        label="Numeric input", icon="🔢", group=GROUP_OPEN,
        storage=STORAGE_NUMERIC, has_choices=False, choices_need_image=False,
        default_chart="histogram",
        description="Typed number, optional min/max bound.",
    ),

    # ── New: Choice (visual) ────────────────────────
    "image_choice": dict(
        label="Image Choice", icon="🖼️", group=GROUP_CHOICE,
        storage=STORAGE_CHOICE, has_choices=True, choices_need_image=True,
        default_chart="bar",
        description="Each option has an image instead of just text.",
        supports_min_max_selections=True,
    ),

    # ── New: Date & time ────────────────────────────
    "date": dict(
        label="Date", icon="📅", group=GROUP_TIME,
        storage=STORAGE_DATETIME, has_choices=False, choices_need_image=False,
        default_chart="timeline",
        description="Pick a calendar date.",
        datetime_kind="date",
    ),
    "datetime": dict(
        label="Date & time", icon="🕒", group=GROUP_TIME,
        storage=STORAGE_DATETIME, has_choices=False, choices_need_image=False,
        default_chart="timeline",
        description="Date plus time-of-day.",
        datetime_kind="datetime",
    ),
    "time": dict(
        label="Time of day", icon="⏰", group=GROUP_TIME,
        storage=STORAGE_DATETIME, has_choices=False, choices_need_image=False,
        default_chart="histogram",
        description="Just hours / minutes.",
        datetime_kind="time",
    ),

    # ── New: Open input ─────────────────────────────
    "file_upload": dict(
        label="Photo / file upload", icon="📎", group=GROUP_OPEN,
        storage=STORAGE_FILE, has_choices=False, choices_need_image=False,
        default_chart="gallery",
        description="Let participants upload a photo or document.",
    ),

    # ── New: Spatial & visual ───────────────────────
    "pin_image": dict(
        label="Pin on image", icon="📌", group=GROUP_SPATIAL,
        storage=STORAGE_COORDINATE, has_choices=False, choices_need_image=False,
        default_chart="heatmap",
        description="Participants click a point on your uploaded image.",
        requires_image=True,
        coordinate_system="image_percent",  # 0..1 of width / height
    ),
    "pin_map": dict(
        label="Pin on map", icon="🌍", group=GROUP_SPATIAL,
        storage=STORAGE_COORDINATE, has_choices=False, choices_need_image=False,
        default_chart="heatmap",
        description="Drop a pin on a geographic map.",
        coordinate_system="lat_lng",
    ),
    "two_by_two": dict(
        label="2×2 matrix", icon="🎯", group=GROUP_SPATIAL,
        storage=STORAGE_COORDINATE, has_choices=False, choices_need_image=False,
        default_chart="scatter",
        description="Place an item on an X/Y grid (e.g. impact vs effort).",
        coordinate_system="bipolar",  # -1..1 on both axes
        axis_labels=dict(x_left="Low impact", x_right="High impact",
                         y_bottom="Hard", y_top="Easy"),
    ),

    # ── New: Ranking & distribution ─────────────────
    "matrix": dict(
        label="Matrix / grid", icon="📐", group=GROUP_RANKING,
        storage=STORAGE_MATRIX, has_choices=True, choices_need_image=False,
        default_chart="heatmap",
        description="Rate each row on the same scale (great for feature surveys).",
        matrix_default_scale=5,
    ),
    "points_allocation": dict(
        label="100 points", icon="🪙", group=GROUP_RANKING,
        storage=STORAGE_POINTS, has_choices=True, choices_need_image=False,
        default_chart="stacked_bar",
        description="Split 100 points across the options.",
        points_total=100,
    ),

    # ── New: Live & reaction ────────────────────────
    "reaction": dict(
        label="Live reactions", icon="🔥", group=GROUP_LIVE,
        storage=STORAGE_EPHEMERAL, has_choices=True, choices_need_image=False,
        default_chart="live_burst",
        description="Live emoji bursts during a session. Not saved.",
        auto_choices=["🔥", "❤️", "😂", "👏", "😮"],
    ),

    # ── New: Slides ─────────────────────────────────
    "title": dict(
        label="Title slide", icon="🎬", group=GROUP_STATIC,
        storage=STORAGE_NONE, has_choices=False, choices_need_image=False,
        default_chart="bar",  # unused; we never render a chart for title slides
        description="A static intro / divider / quote slide. No audience input.",
        is_static=True,
    ),
}


# Helpers
def get_meta(type_id):
    """Return the registry entry for a type, or None."""
    return QUESTION_TYPE_REGISTRY.get(type_id)


def get_storage(type_id):
    meta = QUESTION_TYPE_REGISTRY.get(type_id)
    return meta["storage"] if meta else None


def type_choices():
    """For use in Django field choices=(...)."""
    return [(k, v["label"]) for k, v in QUESTION_TYPE_REGISTRY.items()]


def grouped_for_picker():
    """For the editor's grouped picker. Returns list of (group_label, [entries])."""
    groups = {}
    for tid, meta in QUESTION_TYPE_REGISTRY.items():
        groups.setdefault(meta["group"], []).append(dict(id=tid, **meta))
    # Stable order matching the GROUP_* constants order above
    order = [GROUP_STATIC, GROUP_CHOICE, GROUP_SCALE, GROUP_OPEN, GROUP_RANKING,
             GROUP_TIME, GROUP_SPATIAL, GROUP_LIVE]
    return [(g, groups[g]) for g in order if g in groups]