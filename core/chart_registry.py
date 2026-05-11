"""
Chart-type registry — expanded with more bar/style variants.

`supports` controls which question types may pick each chart.
`group` is just for UI sectioning in the chart picker.
"""

CHARTS = [
    # Bars
    {"id": "bar",              "name": "Bar — classic",     "group": "Bars",    "icon": "bar-chart",      "supports": ["mcq", "scale", "ranking"]},
    {"id": "horizontal_bar",   "name": "Bar — horizontal",  "group": "Bars",    "icon": "bar-chart-line", "supports": ["mcq", "scale", "ranking"]},
    {"id": "rounded_bar",      "name": "Bar — rounded",     "group": "Bars",    "icon": "bar-chart-fill", "supports": ["mcq", "scale", "ranking"]},
    {"id": "gradient_bar",     "name": "Bar — gradient",    "group": "Bars",    "icon": "bar-chart-steps","supports": ["mcq", "scale", "ranking"]},
    {"id": "stacked_bar",      "name": "Bar — stacked",     "group": "Bars",    "icon": "layers",         "supports": ["mcq", "ranking"]},
    {"id": "lollipop",         "name": "Lollipop",          "group": "Bars",    "icon": "dot",            "supports": ["mcq", "scale", "ranking"]},
    {"id": "bubble_count",     "name": "Bubble count",      "group": "Bars",    "icon": "circle-fill",    "supports": ["mcq", "ranking"]},

    # Round
    {"id": "donut",            "name": "Donut",             "group": "Round",   "icon": "circle",         "supports": ["mcq"]},
    {"id": "pie",              "name": "Pie",               "group": "Round",   "icon": "pie-chart",      "supports": ["mcq"]},
    {"id": "polar",            "name": "Polar area",        "group": "Round",   "icon": "compass",        "supports": ["mcq", "scale", "ranking"]},
    {"id": "radar",            "name": "Radar",             "group": "Round",   "icon": "broadcast",      "supports": ["scale", "ranking"]},

    # Lines / progress
    {"id": "line",             "name": "Line",              "group": "Lines",   "icon": "graph-up",       "supports": ["scale", "mcq"]},
    {"id": "area",             "name": "Area",              "group": "Lines",   "icon": "activity",       "supports": ["scale"]},
    {"id": "smooth_area",      "name": "Smooth area",       "group": "Lines",   "icon": "stars",          "supports": ["scale"]},
    {"id": "gauge",            "name": "Gauge",             "group": "Lines",   "icon": "speedometer",    "supports": ["scale"]},
    {"id": "progress_bars",    "name": "Progress bars",     "group": "Lines",   "icon": "list-task",      "supports": ["mcq", "scale", "ranking"]},

    # Text / special
    {"id": "wordcloud",        "name": "Word cloud",        "group": "Words",   "icon": "cloud",          "supports": ["open", "word"]},
    {"id": "open_list",        "name": "Open responses",    "group": "Words",   "icon": "list-ul",        "supports": ["open"]},
    {"id": "tags",              "name": "Tag wall",          "group": "Words",   "icon": "tags",           "supports": ["word", "open"]},

    # Other
    {"id": "map",              "name": "World map",         "group": "Map",     "icon": "geo-alt",        "supports": ["mcq", "open"]},
    {"id": "leaderboard",      "name": "Leaderboard",       "group": "Ranks",   "icon": "trophy",         "supports": ["mcq", "scale"]},
    {"id": "heatmap",          "name": "Heat strip",        "group": "Ranks",   "icon": "grid-3x3-gap",   "supports": ["scale", "ranking"]},
]


def charts_for(question_type: str):
    return [c for c in CHARTS if question_type in c["supports"]]


def chart(chart_id: str):
    for c in CHARTS:
        if c["id"] == chart_id:
            return c
    return None