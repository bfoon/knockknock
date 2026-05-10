"""
Visual template registry — 20 presentation themes users can pick from.
Each template is a CSS color/typography scheme applied at render time.
"""

TEMPLATES = [
    {"id": "midnight",     "name": "Midnight",        "bg": "#0b1020", "fg": "#f5f6ff", "accent": "#7c3aed", "accent2": "#22d3ee", "font": "Inter"},
    {"id": "sunset",       "name": "Sunset Bloom",    "bg": "#1a0b2e", "fg": "#fff5ec", "accent": "#fb7185", "accent2": "#fbbf24", "font": "Poppins"},
    {"id": "neon",         "name": "Neon Arcade",     "bg": "#0a0a0a", "fg": "#39ff14", "accent": "#ff00ea", "accent2": "#00e5ff", "font": "VT323"},
    {"id": "paper",        "name": "Soft Paper",      "bg": "#fdfaf3", "fg": "#1c1c1c", "accent": "#d97706", "accent2": "#0d9488", "font": "Lora"},
    {"id": "minimal",      "name": "Minimal White",   "bg": "#ffffff", "fg": "#111111", "accent": "#000000", "accent2": "#6b7280", "font": "Inter"},
    {"id": "ocean",        "name": "Deep Ocean",      "bg": "#02132b", "fg": "#e6f1ff", "accent": "#38bdf8", "accent2": "#a78bfa", "font": "Manrope"},
    {"id": "forest",       "name": "Forest Trail",    "bg": "#0f1f17", "fg": "#e7f5ec", "accent": "#86efac", "accent2": "#fde68a", "font": "Manrope"},
    {"id": "candy",        "name": "Candy Pop",       "bg": "#fff0f6", "fg": "#3b0764", "accent": "#ec4899", "accent2": "#a855f7", "font": "Poppins"},
    {"id": "corporate",    "name": "Corporate Blue",  "bg": "#f1f5f9", "fg": "#0f172a", "accent": "#1d4ed8", "accent2": "#0ea5e9", "font": "Inter"},
    {"id": "monochrome",   "name": "Monochrome",      "bg": "#1c1c1c", "fg": "#fafafa", "accent": "#fafafa", "accent2": "#a3a3a3", "font": "JetBrains Mono"},
    {"id": "retro",        "name": "Retro 80s",       "bg": "#1a0033", "fg": "#fef9ff", "accent": "#ff2e88", "accent2": "#00e5ff", "font": "Press Start 2P"},
    {"id": "earth",        "name": "Earth Tones",     "bg": "#f5efe6", "fg": "#3e2723", "accent": "#a16207", "accent2": "#65a30d", "font": "Lora"},
    {"id": "lavender",     "name": "Lavender Field",  "bg": "#f5f3ff", "fg": "#1e1b4b", "accent": "#7c3aed", "accent2": "#c026d3", "font": "Manrope"},
    {"id": "coral",        "name": "Coral Reef",      "bg": "#fffbf3", "fg": "#7c2d12", "accent": "#fb923c", "accent2": "#06b6d4", "font": "Poppins"},
    {"id": "graphite",     "name": "Graphite",        "bg": "#2a2d34", "fg": "#f4f6fa", "accent": "#fbbf24", "accent2": "#34d399", "font": "Inter"},
    {"id": "cyber",        "name": "Cyberpunk",       "bg": "#020617", "fg": "#fef9c3", "accent": "#facc15", "accent2": "#ec4899", "font": "Orbitron"},
    {"id": "sakura",       "name": "Sakura",          "bg": "#fff1f3", "fg": "#831843", "accent": "#f43f5e", "accent2": "#a3e635", "font": "Lora"},
    {"id": "mint",         "name": "Fresh Mint",      "bg": "#f0fdfa", "fg": "#134e4a", "accent": "#14b8a6", "accent2": "#f59e0b", "font": "Manrope"},
    {"id": "blueprint",    "name": "Blueprint",       "bg": "#0c4a6e", "fg": "#e0f2fe", "accent": "#fef9c3", "accent2": "#fb7185", "font": "JetBrains Mono"},
    {"id": "obsidian",     "name": "Obsidian Gold",   "bg": "#18181b", "fg": "#fafaf9", "accent": "#eab308", "accent2": "#f97316", "font": "Cormorant Garamond"},
]


def get_template(template_id: str) -> dict:
    for t in TEMPLATES:
        if t["id"] == template_id:
            return t
    return TEMPLATES[0]
