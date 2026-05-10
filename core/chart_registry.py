"""
Chart-type registry: what charts can be picked per question and which question
types they're compatible with.
"""

CHARTS = [
    {"id": "bar",         "name": "Bar Chart",         "icon": "bar-chart",   "supports": ["mcq", "scale", "ranking"]},
    {"id": "horizontal_bar", "name": "Horizontal Bars","icon": "bar-chart-2", "supports": ["mcq", "scale", "ranking"]},
    {"id": "donut",       "name": "Donut",             "icon": "circle",      "supports": ["mcq"]},
    {"id": "pie",         "name": "Pie",               "icon": "pie-chart",   "supports": ["mcq"]},
    {"id": "stacked_bar", "name": "Stacked Bar",       "icon": "layers",      "supports": ["mcq", "ranking"]},
    {"id": "radar",       "name": "Radar",             "icon": "target",      "supports": ["scale", "ranking"]},
    {"id": "line",        "name": "Line",              "icon": "trending-up", "supports": ["scale", "mcq"]},
    {"id": "area",        "name": "Area",              "icon": "activity",    "supports": ["scale"]},
    {"id": "wordcloud",   "name": "Word Cloud",        "icon": "cloud",       "supports": ["open", "word"]},
    {"id": "open_list",   "name": "Open Response Wall","icon": "list",        "supports": ["open"]},
    {"id": "map",         "name": "World Map",         "icon": "map",         "supports": ["mcq", "open"]},
    {"id": "gauge",       "name": "Gauge",             "icon": "speedometer", "supports": ["scale"]},
    {"id": "leaderboard", "name": "Leaderboard",       "icon": "award",       "supports": ["mcq", "scale"]},
]


def charts_for(question_type: str):
    return [c for c in CHARTS if question_type in c["supports"]]
