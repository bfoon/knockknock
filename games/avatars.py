"""
Catalog of avatars participants can choose.

Stored as emoji + label so we don't need image assets; swap to SVGs in
static/img later if desired. The public contract used by templates, the
WebSocket consumer and the exports is:

    {"id", "label", "emoji", "color", "category", "anim"}

`anim` matches a CSS keyframe name in `avatar_anim.css` (kk-float,
kk-bounce, kk-swing, kk-spin, kk-flutter, kk-zoom, kk-blastoff, kk-stomp,
kk-dash, kk-wobble, kk-tilt). Apply `kk-anim-<anim>` to any element to give
it the avatar's signature movement.

ARENA CHARACTERS (built avatars)
────────────────────────────────
Players can also build their own SVG character on the join screen
(static/js/kk_avatars.js). The whole character lives in the id itself:

    kk-<species>-<colour>-<accessory>-<face>      e.g. kk-cat-8-crown-wink

so it rides Participant.avatar_id / GameAnswer.avatar_id (max 30 chars,
longest built id is 23) with no migration. `avatar_by_id` resolves a built
id to a synthetic catalog dict so exports, results pages and leaderboards
show the species emoji and label instead of degrading to the dragon.
Keep BUILT_SPECIES / BUILT_ACCESSORIES / BUILT_FACES in step with the JS.
"""

import re

DEFAULT_AVATAR_ID = "dragon"

AVATARS = [
    # ── Classic ──
    {"id": "dragon",     "label": "Dragon",      "emoji": "🐉", "color": "#dc2626", "category": "classic", "anim": "kk-float"},
    {"id": "sword",      "label": "Sword",       "emoji": "⚔️", "color": "#64748b", "category": "classic", "anim": "kk-swing"},
    {"id": "car",        "label": "Race Car",    "emoji": "🏎️", "color": "#ef4444", "category": "classic", "anim": "kk-dash"},
    {"id": "butterfly",  "label": "Butterfly",   "emoji": "🦋", "color": "#3b82f6", "category": "classic", "anim": "kk-flutter"},
    {"id": "spacecraft", "label": "Spacecraft",  "emoji": "🚀", "color": "#7c3aed", "category": "classic", "anim": "kk-blastoff"},
    {"id": "trex",       "label": "T-Rex",       "emoji": "🦖", "color": "#16a34a", "category": "classic", "anim": "kk-stomp"},
    {"id": "stego",      "label": "Stegosaurus", "emoji": "🦕", "color": "#0d9488", "category": "classic", "anim": "kk-stomp"},
    {"id": "joker",      "label": "Joker Card",  "emoji": "🃏", "color": "#a855f7", "category": "classic", "anim": "kk-wobble"},
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

    # ── Anime ── (emoji-only; no character or franchise references)
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
    {"id": "anime_eye",          "label": "Third Eye",     "emoji": "👁️", "color": "#dc2626", "category": "anime", "anim": "kk-spin"},
    {"id": "anime_yokai",        "label": "Yokai",         "emoji": "👘", "color": "#7c3aed", "category": "anime", "anim": "kk-flutter"},
    {"id": "anime_panda",        "label": "Anime Panda",   "emoji": "🐼", "color": "#27272a", "category": "anime", "anim": "kk-tilt"},
]


CATEGORY_LABELS = [
    ("classic", "Classic"),
    ("anime",   "Anime"),
]

# Built once at import. `avatar_by_id` used to be a linear scan, which the
# leaderboard called once per participant — O(n·m) on every export.
AVATARS_BY_ID = {a["id"]: a for a in AVATARS}

_FALLBACK = AVATARS_BY_ID[DEFAULT_AVATAR_ID]


# ── Built (arena) characters ──
BUILT_SPECIES = {
    "blob": ("Bloop", "🫧"), "cat": ("Whisk", "🐱"), "bear": ("Bruno", "🐻"),
    "bun": ("Hopper", "🐰"), "bird": ("Pip", "🐤"), "bot": ("Bolt", "🤖"),
    "boo": ("Boo", "👻"), "dino": ("Rexy", "🦖"), "octo": ("Inky", "🐙"),
    "zeep": ("Zeep", "👽"), "peng": ("Waddles", "🐧"), "drak": ("Ember", "🐉"),
}
BUILT_COLORS = [
    "#ff6b6b", "#ff9f43", "#feca57", "#1dd1a1", "#10ac84", "#48dbfb",
    "#2e86de", "#5f27cd", "#f368e0", "#a29bfe", "#576574", "#dfe6ee",
]
BUILT_ACCESSORIES = {
    "none": "", "crown": "crown", "cap": "cap", "party": "party hat", "top": "top hat",
    "wiz": "wizard hat", "halo": "halo", "flwr": "flower", "bow": "bow",
    "head": "headset", "glas": "glasses", "band": "headband",
}
BUILT_FACES = {"happy", "cute", "wink", "cool", "star", "tongue"}

_BUILT_RE = re.compile(r"^kk-([a-z]{2,6})-(\d{1,2})-([a-z]{2,6})-([a-z]{2,8})$")


def parse_built_avatar(avatar_id):
    """Return (species, colour_index, accessory, face) for a built id, else None."""
    m = _BUILT_RE.match(str(avatar_id or ""))
    if not m:
        return None
    species, colour, acc, face = m.group(1), int(m.group(2)), m.group(3), m.group(4)
    if species not in BUILT_SPECIES or colour >= len(BUILT_COLORS):
        return None
    if acc not in BUILT_ACCESSORIES or face not in BUILT_FACES:
        return None
    return species, colour, acc, face


def _built_meta(avatar_id):
    parsed = parse_built_avatar(avatar_id)
    if not parsed:
        return None
    species, colour, acc, _face = parsed
    label, emoji = BUILT_SPECIES[species]
    if BUILT_ACCESSORIES[acc]:
        label = f"{label} with {BUILT_ACCESSORIES[acc]}"
    return {
        "id": str(avatar_id),
        "label": label,
        "emoji": emoji,
        "color": BUILT_COLORS[colour],
        "category": "arena",
        "anim": "kk-bounce",
    }


def avatar_by_id(avatar_id):
    """Return the avatar dict for `avatar_id`, or the default dragon.

    Built arena characters resolve to a synthetic dict (species emoji,
    label, body colour). Never raises: stored ids can go stale when the
    catalog changes, and a missing avatar should degrade to a dragon rather
    than 500 a results page.
    """
    if not avatar_id:
        return _FALLBACK
    key = str(avatar_id)
    if key in AVATARS_BY_ID:
        return AVATARS_BY_ID[key]
    return _built_meta(key) or _FALLBACK


def is_valid_avatar_id(avatar_id):
    key = str(avatar_id or "")
    return key in AVATARS_BY_ID or parse_built_avatar(key) is not None


def normalize_avatar_id(avatar_id):
    """Coerce anything to a real catalog id. Use before writing to the DB.

    Built arena ids are kept as-is when well-formed.
    """
    key = str(avatar_id or "").strip()
    return key if is_valid_avatar_id(key) else DEFAULT_AVATAR_ID


def avatars_grouped():
    """Return [(label, [avatars]), ...] for the picker UI."""
    groups = []
    for key, label in CATEGORY_LABELS:
        items = [a for a in AVATARS if a.get("category", "classic") == key]
        if items:
            groups.append((label, items))
    return groups
