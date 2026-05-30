"""Chart registry for Knock-Knock polls.

This registry powers the question editor chart picker. It is deliberately
front-end friendly: each chart id matches either a Chart.js renderer, a custom
SVG/HTML renderer in ``static/js/chart_extra.js``, or a new rich Plotly /
Folium-Leaflet renderer.
"""

from collections import OrderedDict


def _c(label, icon, group="Classic", desc=""):
    return {"label": label, "icon": icon, "group": group, "description": desc}


ALL_CHARTS = OrderedDict([
    # Classic Chart.js / existing renderers
    ("bar", _c("Bar", "📊", "Classic")),
    ("horizontal_bar", _c("Horizontal bar", "▰", "Classic")),
    ("column", _c("Column", "▥", "Classic")),
    ("rounded_bar", _c("Rounded bar", "▤", "Classic")),
    ("gradient_bar", _c("Gradient bar", "🌈", "Classic")),
    ("grouped_bar", _c("Grouped bar", "📚", "Classic")),
    ("stacked_bar", _c("Stacked bar", "🧱", "Classic")),
    ("ranked_bar", _c("Ranked bar", "🏆", "Classic")),
    ("line", _c("Line", "📈", "Classic")),
    ("area", _c("Area", "〽️", "Classic")),
    ("smooth_area", _c("Smooth area", "🌊", "Classic")),
    ("pie", _c("Pie", "🥧", "Classic")),
    ("donut", _c("Donut", "🍩", "Classic")),
    ("doughnut", _c("Doughnut", "⭕", "Classic")),
    ("polar", _c("Polar area", "🧭", "Classic")),
    ("radar", _c("Radar", "🕸️", "Classic")),
    ("scatter", _c("Scatter", "✨", "Classic")),
    ("bubble", _c("Bubble", "🫧", "Classic")),
    ("bubble_count", _c("Bubble count", "🔵", "Classic")),
    ("histogram", _c("Histogram", "▥", "Classic")),
    ("distribution", _c("Distribution", "📉", "Classic")),
    ("avg_marker", _c("Average marker", "🎯", "Classic")),
    ("gauge", _c("Gauge", "🧪", "Classic")),
    ("nps_segments", _c("NPS segments", "🧩", "Classic")),
    ("progress_bars", _c("Progress bars", "📶", "Classic")),
    ("treemap", _c("Treemap", "🟩", "Classic")),
    ("heatmap", _c("Heatmap", "🔥", "Classic")),
    ("flow", _c("Flow", "🌊", "Classic")),
    ("lollipop", _c("Lollipop", "🍭", "Classic")),
    ("leaderboard", _c("Leaderboard", "🥇", "Classic")),
    ("frequency_list", _c("Frequency list", "📋", "Classic")),
    ("responses_list", _c("Response list", "💬", "Classic")),
    ("open_list", _c("Open list", "📝", "Classic")),
    ("quotes_carousel", _c("Quotes", "❝", "Classic")),
    ("wordcloud", _c("Word cloud", "☁️", "Classic")),
    ("tags", _c("Tags", "🏷️", "Classic")),
    ("timeline", _c("Timeline", "🕒", "Classic")),
    ("gallery", _c("Gallery", "🖼️", "Classic")),
    ("live_burst", _c("Live burst", "🎆", "Classic")),
    ("split_card", _c("Split card", "⚖️", "Classic")),
    ("map", _c("Simple map", "🗺️", "Classic")),

    # Plotly rich charts
    ("plotly_bar", _c("Plotly bar", "📊", "Plotly", "Interactive Plotly bar with hover.")),
    ("plotly_hbar", _c("Plotly horizontal", "▰", "Plotly")),
    ("plotly_grouped", _c("Plotly grouped", "📚", "Plotly")),
    ("plotly_stacked", _c("Plotly stacked", "🧱", "Plotly")),
    ("plotly_line", _c("Plotly line", "📈", "Plotly")),
    ("plotly_area", _c("Plotly area", "〽️", "Plotly")),
    ("plotly_pie", _c("Plotly pie", "🥧", "Plotly")),
    ("plotly_donut", _c("Plotly donut", "🍩", "Plotly")),
    ("plotly_scatter", _c("Plotly scatter", "✨", "Plotly")),
    ("plotly_bubble", _c("Plotly bubble", "🫧", "Plotly")),
    ("plotly_heatmap", _c("Plotly heatmap", "🔥", "Plotly")),
    ("plotly_treemap", _c("Plotly treemap", "🟩", "Plotly")),
    ("plotly_funnel", _c("Plotly funnel", "🪄", "Plotly")),
    ("plotly_waterfall", _c("Plotly waterfall", "💧", "Plotly")),
    ("plotly_radar", _c("Plotly radar", "🕸️", "Plotly")),
    ("plotly_gauge", _c("Plotly gauge", "🧭", "Plotly")),
    ("plotly_sunburst", _c("Plotly sunburst", "☀️", "Plotly")),
    ("plotly_geo", _c("Plotly geo map", "🌍", "Maps")),

    # Folium/Leaflet style maps
    ("folium_map", _c("Folium / Leaflet map", "🗺️", "Maps", "Interactive Leaflet map matching Folium output style.")),

    # ── New creative charts (v4) — beyond Mentimeter's default set ──
    ("dot_matrix", _c("Dot matrix", "⣏", "Creative", "Each respondent = one dot. Great for 'X out of 100'.")),
    ("radial_bar", _c("Radial bars", "🌀", "Creative", "Nightingale rose / circular bars with a live total core.")),
    ("comparison_bars", _c("Diverging bars", "🦋", "Creative", "Butterfly split — disagree left, agree right.")),
    ("bee_swarm", _c("Bee swarm", "🐝", "Creative", "Every numeric answer as a dot, with a live average line.")),
    ("packed_circles", _c("Packed circles", "🫧", "Creative", "Polished circle-pack sized by share.")),
    ("hero_number", _c("Hero number", "🔢", "Creative", "Giant animated count-up of the leading answer.")),
    ("stream_graph", _c("Stream graph", "🌊", "Creative", "Flowing themeriver of the top answers.")),
])


CURATED_BY_TYPE = {
    "mcq": ["bar", "donut", "ranked_bar", "dot_matrix", "packed_circles", "radial_bar", "plotly_bar", "plotly_donut", "plotly_treemap"],
    "image_choice": ["bar", "gallery", "dot_matrix", "packed_circles", "plotly_bar", "plotly_donut"],
    "yes_no": ["hero_number", "donut", "split_card", "dot_matrix", "plotly_donut", "plotly_gauge"],
    "likert": ["comparison_bars", "stacked_bar", "heatmap", "radial_bar", "plotly_stacked", "plotly_heatmap"],
    "ranking": ["ranked_bar", "radial_bar", "flow", "plotly_hbar", "plotly_treemap"],
    "word": ["wordcloud", "packed_circles", "stream_graph", "tags", "frequency_list", "plotly_bar"],
    "open": ["responses_list", "quotes_carousel", "stream_graph", "tags", "plotly_bar"],
    "scale": ["histogram", "bee_swarm", "gauge", "distribution", "plotly_gauge", "plotly_line", "plotly_heatmap"],
    "rating": ["avg_marker", "radial_bar", "gauge", "histogram", "plotly_gauge", "plotly_bar"],
    "nps": ["nps_segments", "hero_number", "gauge", "bee_swarm", "plotly_gauge", "plotly_bar"],
    "slider": ["histogram", "bee_swarm", "gauge", "plotly_gauge", "plotly_line"],
    "numeric": ["histogram", "bee_swarm", "distribution", "plotly_bar", "plotly_line"],
    "date": ["timeline", "line", "stream_graph", "plotly_line"],
    "datetime": ["timeline", "line", "stream_graph", "plotly_line"],
    "time": ["timeline", "line", "radial_bar", "plotly_line"],
    "pin_image": ["heatmap", "scatter", "plotly_heatmap"],
    "pin_map": ["folium_map", "plotly_geo", "map", "heatmap", "scatter"],
    "two_by_two": ["scatter", "heatmap", "plotly_scatter", "plotly_heatmap"],
    "matrix": ["heatmap", "comparison_bars", "plotly_heatmap", "stacked_bar"],
    "points_allocation": ["ranked_bar", "treemap", "dot_matrix", "progress_bars", "plotly_treemap", "plotly_hbar"],
    "reaction": ["live_burst", "bubble_count", "packed_circles", "tags", "plotly_bubble"],
}

DEFAULT_CURATED = ["bar", "line", "donut", "plotly_bar", "plotly_line", "plotly_donut"]


def curated_charts_for(question_type):
    ids = CURATED_BY_TYPE.get(question_type, DEFAULT_CURATED)
    return [(cid, ALL_CHARTS[cid]) for cid in ids if cid in ALL_CHARTS]


def is_chart_curated_for(chart_id, question_type):
    return any(cid == chart_id for cid, _ in curated_charts_for(question_type))


def chart_choice_field_choices():
    return [(cid, meta["label"]) for cid, meta in ALL_CHARTS.items()]