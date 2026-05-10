"""
Catalog of avatars participants can choose. Stored as emoji + label so we don't
need image assets; swap to SVGs in static/img later if desired.
"""

AVATARS = [
    {"id": "dragon",      "label": "Dragon",        "emoji": "🐉", "color": "#dc2626"},
    {"id": "sword",       "label": "Sword",         "emoji": "⚔️", "color": "#64748b"},
    {"id": "car",         "label": "Race Car",      "emoji": "🏎️", "color": "#ef4444"},
    {"id": "butterfly",   "label": "Butterfly",     "emoji": "🦋", "color": "#3b82f6"},
    {"id": "spacecraft",  "label": "Spacecraft",    "emoji": "🚀", "color": "#7c3aed"},
    {"id": "trex",        "label": "T-Rex",         "emoji": "🦖", "color": "#16a34a"},
    {"id": "stego",       "label": "Stegosaurus",   "emoji": "🦕", "color": "#0d9488"},
    {"id": "joker",       "label": "Joker Mask",    "emoji": "🃏", "color": "#a855f7"},
    {"id": "unicorn",     "label": "Unicorn",       "emoji": "🦄", "color": "#ec4899"},
    {"id": "wizard",      "label": "Wizard",        "emoji": "🧙", "color": "#6366f1"},
    {"id": "ninja",       "label": "Ninja",         "emoji": "🥷", "color": "#1f2937"},
    {"id": "alien",       "label": "Alien",         "emoji": "👽", "color": "#22c55e"},
    {"id": "ghost",       "label": "Ghost",         "emoji": "👻", "color": "#f3f4f6"},
    {"id": "robot",       "label": "Robot",         "emoji": "🤖", "color": "#0ea5e9"},
    {"id": "fox",         "label": "Fox",           "emoji": "🦊", "color": "#ea580c"},
    {"id": "octopus",     "label": "Octopus",       "emoji": "🐙", "color": "#db2777"},
    {"id": "shark",       "label": "Shark",         "emoji": "🦈", "color": "#0891b2"},
    {"id": "tiger",       "label": "Tiger",         "emoji": "🐯", "color": "#f59e0b"},
    {"id": "panda",       "label": "Panda",         "emoji": "🐼", "color": "#27272a"},
    {"id": "wolf",        "label": "Wolf",          "emoji": "🐺", "color": "#475569"},
]


def avatar_by_id(avatar_id):
    for a in AVATARS:
        if a["id"] == avatar_id:
            return a
    return AVATARS[0]
