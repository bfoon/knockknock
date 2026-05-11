"""
Curated chart options per question type.

The editor shows the curated list by default; toggling "show all chart types"
exposes the full set in ALL_CHARTS so power users can override.

Adding a chart? Add it to ALL_CHARTS (its label + icon) and to any
question types that should offer it by default.
"""

# All charts ever supported, with metadata used by the picker and renderer.
ALL_CHARTS = {
    # ── Bar / column family ─────────────────────────
    "bar":            dict(label="Bar", icon="📊"),
    "column":         dict(label="Column", icon="📈"),
    "horizontal_bar": dict(label="Horizontal bar", icon="↔️"),
    "stacked_bar":    dict(label="Stacked bar", icon="🥞"),
    "grouped_bar":    dict(label="Grouped bar", icon="🪜"),
    "ranked_bar":     dict(label="Ranked bar", icon="🏆"),

    # ── Circular ────────────────────────────────────
    "pie":            dict(label="Pie", icon="🥧"),
    "donut":          dict(label="Donut", icon="🍩"),
    "gauge":          dict(label="Gauge", icon="🌡️"),

    # ── Distribution ────────────────────────────────
    "histogram":      dict(label="Histogram", icon="📐"),
    "distribution":   dict(label="Distribution curve", icon="🔔"),
    "avg_marker":     dict(label="Average marker", icon="🎯"),

    # ── Score-specific ──────────────────────────────
    "nps_segments":   dict(label="NPS segments", icon="🟥🟨🟩"),
    "split_card":     dict(label="Split card (Yes/No)", icon="🟢🔴"),

    # ── Text / open ─────────────────────────────────
    "wordcloud":       dict(label="Word cloud", icon="☁️"),
    "bubble":          dict(label="Bubbles", icon="🫧"),
    "frequency_list":  dict(label="Frequency list", icon="📋"),
    "responses_list":  dict(label="Responses list", icon="🗒️"),
    "quotes_carousel": dict(label="Quotes carousel", icon="💬"),

    # ── Ranking / flow ──────────────────────────────
    "flow":           dict(label="Flow / Sankey", icon="🌊"),
    "treemap":        dict(label="Treemap", icon="🗂️"),

    # ── Spatial ─────────────────────────────────────
    "heatmap":        dict(label="Heatmap", icon="🔥"),
    "scatter":        dict(label="Scatter", icon="✨"),

    # ── Time ────────────────────────────────────────
    "timeline":       dict(label="Timeline", icon="📆"),

    # ── Media ───────────────────────────────────────
    "gallery":        dict(label="Gallery", icon="🖼️"),

    # ── Live ────────────────────────────────────────
    "live_burst":     dict(label="Live emoji burst", icon="🎆"),
}


# Curated default chart set per question type.
CHART_CHOICES_BY_TYPE = {
    "mcq":               ["bar", "column", "donut", "pie", "horizontal_bar", "treemap"],
    "word":              ["wordcloud", "bubble", "frequency_list"],
    "scale":             ["histogram", "gauge", "bar", "avg_marker"],
    "open":              ["responses_list", "wordcloud", "quotes_carousel"],
    "ranking":           ["ranked_bar", "flow", "horizontal_bar"],

    "rating":            ["avg_marker", "histogram", "bar", "gauge"],
    "nps":               ["nps_segments", "histogram", "gauge"],
    "yes_no":            ["split_card", "donut", "bar"],
    "likert":            ["stacked_bar", "bar", "histogram"],
    "slider":            ["distribution", "histogram", "avg_marker"],
    "numeric":           ["histogram", "distribution", "avg_marker"],

    "image_choice":      ["bar", "column", "donut", "treemap"],

    "date":              ["timeline", "histogram"],
    "datetime":          ["timeline", "histogram"],
    "time":              ["histogram", "timeline"],

    "file_upload":       ["gallery"],

    "pin_image":         ["heatmap", "scatter"],
    "pin_map":           ["heatmap", "scatter"],
    "two_by_two":        ["scatter", "heatmap"],

    "matrix":            ["heatmap", "stacked_bar", "grouped_bar"],
    "points_allocation": ["stacked_bar", "bar", "pie"],

    "reaction":          ["live_burst"],
}


def curated_charts_for(type_id):
    """Returns list of (chart_id, meta) tuples for the curated set."""
    ids = CHART_CHOICES_BY_TYPE.get(type_id, ["bar"])
    return [(cid, ALL_CHARTS[cid]) for cid in ids if cid in ALL_CHARTS]


def all_charts():
    """Returns list of (chart_id, meta) tuples for every chart."""
    return list(ALL_CHARTS.items())


def is_chart_curated_for(type_id, chart_id):
    return chart_id in CHART_CHOICES_BY_TYPE.get(type_id, [])


def chart_choice_field_choices():
    """For ChoiceField(choices=…) — flat list of all charts."""
    return [(cid, meta["label"]) for cid, meta in ALL_CHARTS.items()]
