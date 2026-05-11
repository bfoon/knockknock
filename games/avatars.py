"""
Catalog of avatars participants can choose. Stored as emoji + label so we don't
need image assets; swap to SVGs in static/img later if desired.

Each avatar has an `anim` field that matches a CSS keyframe name in
`avatar_anim.css` (kk-float, kk-bounce, kk-swing, kk-spin, kk-flutter, kk-zoom,
kk-blastoff, kk-stomp, kk-dash, kk-wobble, kk-tilt). Apply the class
`kk-anim-<anim>` to any element to give it the avatar's signature movement.
"""

AVATARS = [
    # ── Classic ──
    {"id": "dragon",     "label": "Dragon",      "emoji": "🐉", "color": "#dc2626", "category": "classic", "anim": "kk-float"},
    {"id": "sword",      "label": "Sword",       "emoji": "⚔️", "color": "#64748b", "category": "classic", "anim": "kk-swing"},
    {"id": "car",        "label": "Race Car",    "emoji": "🏎️", "color": "#ef4444", "category": "classic", "anim": "kk-dash"},
    {"id": "butterfly",  "label": "Butterfly",   "emoji": "🦋", "color": "#3b82f6", "category": "classic", "anim": "kk-flutter"},
    {"id": "spacecraft", "label": "Spacecraft",  "emoji": "🚀", "color": "#7c3aed", "category": "classic", "anim": "kk-blastoff"},
    {"id": "trex",       "label": "T-Rex",       "emoji": "🦖", "color": "#16a34a", "category": "classic", "anim": "kk-stomp"},
    {"id": "stego",      "label": "Stegosaurus", "emoji": "🦕", "color": "#0d9488", "category": "classic", "anim": "kk-stomp"},
    {"id": "joker",      "label": "Joker Mask",  "emoji": "🃏", "color": "#a855f7", "category": "classic", "anim": "kk-wobble"},
    {"id": "unicorn",    "label": "Unicorn",     "emoji": "🦄", "color": "#ec4899", "category": "classic", "anim": "kk-bounce"},
    {"id": "wizard",     "label": "Wizard",      "emoji": "🧙", "color": "#6366f1", "category": "classic", "anim": "kk-tilt"},
    {"id": "ninja",      "label": "Ninja",       "emoji": "🥷", "color": "#1f2937", "category": "classic", "anim": "kk-dash"},
    {"id": "alien",      "label": "Alien",       "emoji": "👽", "color": "#22c55e", "category": "classic", "anim": "kk-float"},
    {"id": "ghost",      "label": "Ghost",       "emoji": "👻", "color": "#f3f4f6", "category": "classic", "anim": "kk-float"},
    {"id": "robot",      "label": "Robot",       "emoji": "🤖", "color": "#0ea5e9", "category": "classic", "anim": "kk-stomp"},
    {"id": "fox",        "label": "Fox",         "emoji": "🦊", "color": "#ea580c", "category": "classic", "anim": "kk-bounce"},
    {"id": "octopus",    "label": "Octopus",     "emoji": "🐙", "color": "#db2777", "category": "classic", "anim": "kk-wobble"},
    {"id": "shark",      "label": "Shark",       "emoji": "🦈", "color": "#0891b2", "category": "classic", "anim": "kk-zoom"},
    {"id": "tiger",      "label": "Tiger",       "emoji": "🐯", "color": "#f59e0b", "category": "classic", "anim": "kk-bounce"},
    {"id": "panda",      "label": "Panda",       "emoji": "🐼", "color": "#27272a", "category": "classic", "anim": "kk-tilt"},
    {"id": "wolf",       "label": "Wolf",        "emoji": "🐺", "color": "#475569", "category": "classic", "anim": "kk-tilt"},

    # ── Anime ── (emoji-only, no copyrighted IP)
    {"id": "anime_hero",         "label": "Hero",          "emoji": "🦸", "color": "#3b82f6", "category": "anime", "anim": "kk-blastoff"},
    {"id": "anime_star",         "label": "Star",          "emoji": "⭐", "color": "#fbbf24", "category": "anime", "anim": "kk-spin"},
    {"id": "anime_sparkle",      "label": "Sparkle",       "emoji": "✨", "color": "#fde047", "category": "anime", "anim": "kk-flutter"},
    {"id": "anime_kawaii",       "label": "Kawaii Face",   "emoji": "🥺", "color": "#fda4af", "category": "anime", "anim": "kk-bounce"},
    {"id": "anime_neko",         "label": "Neko",          "emoji": "🐱", "color": "#fb923c", "category": "anime", "anim": "kk-bounce"},
    {"id": "anime_kitsune",      "label": "Kitsune",       "emoji": "🦊", "color": "#f97316", "category": "anime", "anim": "kk-dash"},
    {"id": "anime_oni",          "label": "Oni",           "emoji": "👹", "color": "#dc2626", "category": "anime", "anim": "kk-stomp"},
    {"id": "anime_tengu",        "label": "Tengu",         "emoji": "👺", "color": "#b91c1c", "category": "anime", "anim": "kk-wobble"},
    {"id": "anime_samurai",      "label": "Samurai",       "emoji": "🗡️", "color": "#64748b", "category": "anime", "anim": "kk-swing"},
    {"id": "anime_magicalgirl",  "label": "Magical Girl",  "emoji": "🌟", "color": "#ec4899", "category": "anime", "anim": "kk-spin"},
    {"id": "anime_ramen",        "label": "Ramen",         "emoji": "🍜", "color": "#f59e0b", "category": "anime", "anim": "kk-float"},
    {"id": "anime_mecha",        "label": "Mecha",         "emoji": "🤖", "color": "#475569", "category": "anime", "anim": "kk-stomp"},
    {"id": "anime_dango",        "label": "Dango",         "emoji": "🍡", "color": "#fda4af", "category": "anime", "anim": "kk-float"},
    {"id": "anime_lantern",      "label": "Lantern",       "emoji": "🏮", "color": "#dc2626", "category": "anime", "anim": "kk-swing"},
    {"id": "anime_cherry",       "label": "Sakura",        "emoji": "🌸", "color": "#fbcfe8", "category": "anime", "anim": "kk-flutter"},
    {"id": "anime_thunder",      "label": "Thunder",       "emoji": "⚡", "color": "#fde047", "category": "anime", "anim": "kk-zoom"},
    {"id": "anime_fire",         "label": "Fire",          "emoji": "🔥", "color": "#f97316", "category": "anime", "anim": "kk-bounce"},
    {"id": "anime_water",        "label": "Water",         "emoji": "💧", "color": "#0ea5e9", "category": "anime", "anim": "kk-float"},
    {"id": "anime_heart",        "label": "Heart",         "emoji": "💖", "color": "#ec4899", "category": "anime", "anim": "kk-bounce"},
    {"id": "anime_skull",        "label": "Skull",         "emoji": "💀", "color": "#1f2937", "category": "anime", "anim": "kk-tilt"},
    {"id": "anime_crown",        "label": "Crown",         "emoji": "👑", "color": "#fbbf24", "category": "anime", "anim": "kk-float"},
    {"id": "anime_eye",          "label": "Sharingan-ish", "emoji": "👁️", "color": "#dc2626", "category": "anime", "anim": "kk-spin"},
    {"id": "anime_yokai",        "label": "Yokai",         "emoji": "👘", "color": "#7c3aed", "category": "anime", "anim": "kk-flutter"},
    {"id": "anime_panda",        "label": "Anime Panda",   "emoji": "🐼", "color": "#27272a", "category": "anime", "anim": "kk-tilt"},
]


CATEGORY_LABELS = [
    ("classic", "Classic"),
    ("anime",   "Anime"),
]


def avatar_by_id(avatar_id):
    for a in AVATARS:
        if a["id"] == avatar_id:
            return a
    return AVATARS[0]


def avatars_grouped():
    """Return [(label, [avatars]), ...] for the picker UI."""
    groups = []
    for key, label in CATEGORY_LABELS:
        items = [a for a in AVATARS if a.get("category", "classic") == key]
        if items:
            groups.append((label, items))
    return groups