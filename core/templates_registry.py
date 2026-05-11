"""
Visual template registry — 20 presentation themes.
Each template has a CSS background expression (`bg_css`) used in the live
presentation. `bg` stays as a flat fallback for the picker preview tiles.

Fun additions:
  - radial/conic/mesh-gradient backgrounds
  - subtle SVG-pattern overlays (encoded inline, no external requests)
  - high-contrast accent pairs tuned for chart legibility
"""

def _svg_pattern_dots(color: str, opacity: float = 0.08) -> str:
    """Tiny inline SVG dot grid, returned as a `url(data:...)` value."""
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40">'
        f'<circle cx="2" cy="2" r="1.2" fill="{color}" fill-opacity="{opacity}"/>'
        f'</svg>'
    )
    return "url(\"data:image/svg+xml;utf8," + svg.replace("#", "%23") + "\")"


def _svg_pattern_grid(color: str, opacity: float = 0.06) -> str:
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50">'
        f'<path d="M0 0h50v50h-50z" fill="none"/>'
        f'<path d="M0 0v50M0 0h50" stroke="{color}" stroke-opacity="{opacity}" stroke-width="1"/>'
        f'</svg>'
    )
    return "url(\"data:image/svg+xml;utf8," + svg.replace("#", "%23") + "\")"


def _svg_pattern_diagonal(color: str, opacity: float = 0.08) -> str:
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">'
        f'<path d="M-2 22 L22 -2" stroke="{color}" stroke-opacity="{opacity}" stroke-width="2"/>'
        f'</svg>'
    )
    return "url(\"data:image/svg+xml;utf8," + svg.replace("#", "%23") + "\")"


TEMPLATES = [
    {
        "id": "midnight", "name": "Midnight Aurora",
        "bg": "#0b1020", "fg": "#f5f6ff",
        "accent": "#7c3aed", "accent2": "#22d3ee", "font": "Inter",
        "bg_css": (
            "radial-gradient(900px 600px at 10% 0%, rgba(124,58,237,.45), transparent 60%),"
            "radial-gradient(800px 500px at 90% 100%, rgba(34,211,238,.30), transparent 60%),"
            "linear-gradient(140deg, #0b1020 0%, #1a1340 100%)"
        ),
        "overlay": _svg_pattern_dots("#ffffff", 0.05),
    },
    {
        "id": "sunset", "name": "Sunset Bloom",
        "bg": "#1a0b2e", "fg": "#fff5ec",
        "accent": "#fb7185", "accent2": "#fbbf24", "font": "Poppins",
        "bg_css": (
            "radial-gradient(700px 500px at 20% 20%, rgba(251,191,36,.45), transparent 60%),"
            "radial-gradient(800px 600px at 80% 90%, rgba(251,113,133,.50), transparent 60%),"
            "linear-gradient(135deg, #1a0b2e 0%, #5b1f4f 60%, #7c2d12 100%)"
        ),
        "overlay": _svg_pattern_dots("#fff5ec", 0.06),
    },
    {
        "id": "neon", "name": "Neon Arcade",
        "bg": "#0a0a0a", "fg": "#39ff14",
        "accent": "#ff00ea", "accent2": "#00e5ff", "font": "VT323",
        "bg_css": (
            "radial-gradient(600px 400px at 30% 30%, rgba(255,0,234,.30), transparent 60%),"
            "radial-gradient(600px 400px at 70% 70%, rgba(0,229,255,.30), transparent 60%),"
            "linear-gradient(180deg, #0a0a0a 0%, #150018 100%)"
        ),
        "overlay": _svg_pattern_grid("#39ff14", 0.10),
    },
    {
        "id": "paper", "name": "Soft Paper",
        "bg": "#fdfaf3", "fg": "#1c1c1c",
        "accent": "#d97706", "accent2": "#0d9488", "font": "Lora",
        "bg_css": (
            "radial-gradient(800px 500px at 100% 0%, rgba(217,119,6,.10), transparent 70%),"
            "linear-gradient(135deg, #fdfaf3 0%, #f5ecd9 100%)"
        ),
        "overlay": _svg_pattern_dots("#1c1c1c", 0.05),
    },
    {
        "id": "minimal", "name": "Minimal White",
        "bg": "#ffffff", "fg": "#111111",
        "accent": "#000000", "accent2": "#6b7280", "font": "Inter",
        "bg_css": "linear-gradient(180deg, #ffffff 0%, #f3f4f6 100%)",
        "overlay": _svg_pattern_grid("#000000", 0.03),
    },
    {
        "id": "ocean", "name": "Deep Ocean",
        "bg": "#02132b", "fg": "#e6f1ff",
        "accent": "#38bdf8", "accent2": "#a78bfa", "font": "Manrope",
        "bg_css": (
            "radial-gradient(900px 600px at 50% 0%, rgba(56,189,248,.30), transparent 65%),"
            "radial-gradient(700px 500px at 0% 100%, rgba(167,139,250,.25), transparent 65%),"
            "linear-gradient(180deg, #02132b 0%, #0a2540 100%)"
        ),
        "overlay": _svg_pattern_dots("#38bdf8", 0.10),
    },
    {
        "id": "forest", "name": "Forest Trail",
        "bg": "#0f1f17", "fg": "#e7f5ec",
        "accent": "#86efac", "accent2": "#fde68a", "font": "Manrope",
        "bg_css": (
            "radial-gradient(600px 500px at 20% 80%, rgba(134,239,172,.20), transparent 65%),"
            "radial-gradient(600px 500px at 80% 20%, rgba(253,230,138,.15), transparent 65%),"
            "linear-gradient(160deg, #0f1f17 0%, #1c3a2a 100%)"
        ),
        "overlay": _svg_pattern_diagonal("#86efac", 0.06),
    },
    {
        "id": "candy", "name": "Candy Pop",
        "bg": "#fff0f6", "fg": "#3b0764",
        "accent": "#ec4899", "accent2": "#a855f7", "font": "Poppins",
        "bg_css": (
            "radial-gradient(500px 400px at 10% 20%, rgba(236,72,153,.30), transparent 60%),"
            "radial-gradient(500px 400px at 90% 80%, rgba(168,85,247,.30), transparent 60%),"
            "radial-gradient(400px 400px at 50% 50%, rgba(253,230,138,.20), transparent 60%),"
            "linear-gradient(135deg, #fff0f6 0%, #fce7f3 100%)"
        ),
        "overlay": _svg_pattern_dots("#3b0764", 0.05),
    },
    {
        "id": "corporate", "name": "Corporate Blue",
        "bg": "#f1f5f9", "fg": "#0f172a",
        "accent": "#1d4ed8", "accent2": "#0ea5e9", "font": "Inter",
        "bg_css": (
            "radial-gradient(700px 500px at 100% 0%, rgba(29,78,216,.10), transparent 65%),"
            "linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)"
        ),
        "overlay": _svg_pattern_grid("#0f172a", 0.04),
    },
    {
        "id": "monochrome", "name": "Monochrome",
        "bg": "#1c1c1c", "fg": "#fafafa",
        "accent": "#fafafa", "accent2": "#a3a3a3", "font": "JetBrains Mono",
        "bg_css": "linear-gradient(180deg, #1c1c1c 0%, #0a0a0a 100%)",
        "overlay": _svg_pattern_diagonal("#fafafa", 0.04),
    },
    {
        "id": "retro", "name": "Retro 80s",
        "bg": "#1a0033", "fg": "#fef9ff",
        "accent": "#ff2e88", "accent2": "#00e5ff", "font": "Press Start 2P",
        "bg_css": (
            "radial-gradient(800px 600px at 50% 100%, rgba(255,46,136,.40), transparent 60%),"
            "linear-gradient(180deg, #1a0033 0%, #2d004d 50%, #5b005b 100%)"
        ),
        "overlay": _svg_pattern_grid("#00e5ff", 0.10),
    },
    {
        "id": "earth", "name": "Earth Tones",
        "bg": "#f5efe6", "fg": "#3e2723",
        "accent": "#a16207", "accent2": "#65a30d", "font": "Lora",
        "bg_css": (
            "radial-gradient(600px 400px at 80% 20%, rgba(161,98,7,.18), transparent 65%),"
            "linear-gradient(135deg, #f5efe6 0%, #e7d9c4 100%)"
        ),
        "overlay": _svg_pattern_dots("#3e2723", 0.06),
    },
    {
        "id": "lavender", "name": "Lavender Field",
        "bg": "#f5f3ff", "fg": "#1e1b4b",
        "accent": "#7c3aed", "accent2": "#c026d3", "font": "Manrope",
        "bg_css": (
            "radial-gradient(700px 500px at 0% 100%, rgba(124,58,237,.25), transparent 65%),"
            "radial-gradient(500px 400px at 100% 0%, rgba(192,38,211,.20), transparent 65%),"
            "linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)"
        ),
        "overlay": _svg_pattern_dots("#1e1b4b", 0.05),
    },
    {
        "id": "coral", "name": "Coral Reef",
        "bg": "#fffbf3", "fg": "#7c2d12",
        "accent": "#fb923c", "accent2": "#06b6d4", "font": "Poppins",
        "bg_css": (
            "radial-gradient(600px 500px at 20% 0%, rgba(251,146,60,.25), transparent 65%),"
            "radial-gradient(600px 500px at 100% 100%, rgba(6,182,212,.20), transparent 65%),"
            "linear-gradient(135deg, #fffbf3 0%, #fff7ed 100%)"
        ),
        "overlay": _svg_pattern_dots("#7c2d12", 0.05),
    },
    {
        "id": "graphite", "name": "Graphite Gold",
        "bg": "#2a2d34", "fg": "#f4f6fa",
        "accent": "#fbbf24", "accent2": "#34d399", "font": "Inter",
        "bg_css": (
            "radial-gradient(800px 500px at 100% 0%, rgba(251,191,36,.18), transparent 65%),"
            "linear-gradient(135deg, #2a2d34 0%, #1a1d24 100%)"
        ),
        "overlay": _svg_pattern_diagonal("#fbbf24", 0.05),
    },
    {
        "id": "cyber", "name": "Cyberpunk",
        "bg": "#020617", "fg": "#fef9c3",
        "accent": "#facc15", "accent2": "#ec4899", "font": "Orbitron",
        "bg_css": (
            "radial-gradient(600px 400px at 30% 20%, rgba(236,72,153,.25), transparent 60%),"
            "radial-gradient(600px 400px at 70% 80%, rgba(250,204,21,.20), transparent 60%),"
            "linear-gradient(135deg, #020617 0%, #1e1b4b 100%)"
        ),
        "overlay": _svg_pattern_grid("#facc15", 0.08),
    },
    {
        "id": "sakura", "name": "Sakura Bloom",
        "bg": "#fff1f3", "fg": "#831843",
        "accent": "#f43f5e", "accent2": "#a3e635", "font": "Lora",
        "bg_css": (
            "radial-gradient(600px 400px at 80% 20%, rgba(244,63,94,.20), transparent 65%),"
            "radial-gradient(500px 400px at 20% 80%, rgba(163,230,53,.15), transparent 65%),"
            "linear-gradient(135deg, #fff1f3 0%, #ffe4e6 100%)"
        ),
        "overlay": _svg_pattern_dots("#831843", 0.05),
    },
    {
        "id": "mint", "name": "Fresh Mint",
        "bg": "#f0fdfa", "fg": "#134e4a",
        "accent": "#14b8a6", "accent2": "#f59e0b", "font": "Manrope",
        "bg_css": (
            "radial-gradient(600px 500px at 100% 0%, rgba(20,184,166,.20), transparent 65%),"
            "linear-gradient(135deg, #f0fdfa 0%, #ccfbf1 100%)"
        ),
        "overlay": _svg_pattern_dots("#134e4a", 0.05),
    },
    {
        "id": "blueprint", "name": "Blueprint",
        "bg": "#0c4a6e", "fg": "#e0f2fe",
        "accent": "#fef9c3", "accent2": "#fb7185", "font": "JetBrains Mono",
        "bg_css": (
            "radial-gradient(700px 500px at 50% 0%, rgba(224,242,254,.10), transparent 65%),"
            "linear-gradient(180deg, #0c4a6e 0%, #082f49 100%)"
        ),
        "overlay": _svg_pattern_grid("#e0f2fe", 0.12),
    },
    {
        "id": "obsidian", "name": "Obsidian Gold",
        "bg": "#18181b", "fg": "#fafaf9",
        "accent": "#eab308", "accent2": "#f97316", "font": "Cormorant Garamond",
        "bg_css": (
            "radial-gradient(700px 500px at 50% 0%, rgba(234,179,8,.18), transparent 65%),"
            "radial-gradient(500px 400px at 50% 100%, rgba(249,115,22,.15), transparent 65%),"
            "linear-gradient(180deg, #18181b 0%, #0a0a0a 100%)"
        ),
        "overlay": _svg_pattern_dots("#eab308", 0.06),
    },
]


def get_template(template_id: str) -> dict:
    for t in TEMPLATES:
        if t["id"] == template_id:
            return t
    return TEMPLATES[0]