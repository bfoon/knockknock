"""
Catalog of icebreaker games available in Knock-Knock.

Each entry is a small, self-contained activity the presenter projects on
the screen. Some are pure-screen (just watch and follow); others can
optionally accept phone input from participants via a 6-digit join code.

Adding a new game?
  1. Add an entry below (id must match the JS module filename).
  2. Create static/icebreakers/js/games/<id>.js exporting `init(host, opts)`.
  3. (Optional) If the game accepts phones, expose `wantsPhones: true` so
     the runner shows the QR/code panel.
"""

GAMES = [
    {
        "id": "posture_reset",
        "name": "Posture Reset",
        "emoji": "🧘",
        "tagline": "60-second gentle stretch — neck, shoulders, spine.",
        "duration_seconds": 60,
        "intensity": "seated",
        "supports_phones": False,
        "color_a": "#22d3ee",
        "color_b": "#7c3aed",
        "description": (
            "A calm 60-second sequence with a 3D figure demonstrating five "
            "seated stretches. Best after a long meeting block. No talking "
            "required."
        ),
    },
    {
        "id": "two_truths",
        "name": "Two Truths & A Bluff",
        "emoji": "🎭",
        "tagline": "Submit three statements — the room votes which is fake.",
        "duration_seconds": None,
        "intensity": "seated",
        "supports_phones": True,
        "color_a": "#fbbf24",
        "color_b": "#fb7185",
        "description": (
            "Classic icebreaker, faster. Players submit their three "
            "statements on their phones. Each player gets the spotlight; "
            "the room votes which one is the bluff. Live tally on screen."
        ),
    },
    {
        "id": "reaction_race",
        "name": "Reaction Race",
        "emoji": "⚡",
        "tagline": "Watch the colour. Tap when it turns green. Fastest wins.",
        "duration_seconds": None,
        "intensity": "seated",
        "supports_phones": True,
        "color_a": "#a3e635",
        "color_b": "#06b6d4",
        "description": (
            "A pulsing 3D orb cycles through colours. Tap your phone the "
            "instant it turns green. Five rounds, lowest cumulative time "
            "wins. Wakes up a sleepy room in 90 seconds flat."
        ),
    },
    {
        "id": "common_ground",
        "name": "Common Ground Bingo",
        "emoji": "🎲",
        "tagline": "Stand if it's true. Sit if it's not. See who matches.",
        "duration_seconds": None,
        "intensity": "standing",
        "supports_phones": False,
        "color_a": "#fb7185",
        "color_b": "#8b5cf6",
        "description": (
            "A rotating 3D cube reveals one trait at a time ('Has lived in "
            "three or more countries', 'Speaks more than two languages'). "
            "Stand up if it applies to you. Quiet, observational, no "
            "phones needed — but a great pattern-spotter."
        ),
    },
    {
        "id": "mood_constellation",
        "name": "Mood Constellation",
        "emoji": "✨",
        "tagline": "One word + energy 1–10. The room becomes a starfield.",
        "duration_seconds": None,
        "intensity": "seated",
        "supports_phones": True,
        "color_a": "#22d3ee",
        "color_b": "#fbbf24",
        "description": (
            "Each participant submits one word for how they're feeling and "
            "a 1–10 energy score. Words float in a 3D starfield, sized by "
            "frequency, positioned by energy. Gentle, beautiful, honest."
        ),
    },
    {
        "id": "conductor",
        "name": "The Conductor",
        "emoji": "🎼",
        "tagline": "Follow the tempo — clap, snap, tap, repeat.",
        "duration_seconds": 90,
        "intensity": "seated",
        "supports_phones": False,
        "color_a": "#8b5cf6",
        "color_b": "#fb7185",
        "description": (
            "An animated baton sets a rhythm. The screen shows what motion "
            "to do (clap, snap, foot-tap, two-finger drum) in sync. Tempo "
            "builds, then settles. Zero awkwardness — everyone matches the "
            "screen, not each other."
        ),
    },
    {
        "id": "desk_yoga",
        "name": "Desk Yoga Flow",
        "emoji": "🌿",
        "tagline": "Four stations, thirty seconds each, professional cues.",
        "duration_seconds": 120,
        "intensity": "seated",
        "supports_phones": False,
        "color_a": "#a3e635",
        "color_b": "#22d3ee",
        "description": (
            "Four micro-stretches with a calm 3D figure demonstrating "
            "each: neck rolls, shoulder shrugs, seated spinal twist, "
            "ankle circles. Smooth transitions, breathing cues on screen, "
            "no chanting or anything weird."
        ),
    },
    {
        "id": "word_chain",
        "name": "Association Chain",
        "emoji": "🔗",
        "tagline": "One word leads to the next. The chain becomes a river.",
        "duration_seconds": None,
        "intensity": "seated",
        "supports_phones": True,
        "color_a": "#06b6d4",
        "color_b": "#8b5cf6",
        "description": (
            "The presenter seeds a word. The next participant submits the "
            "first word that comes to mind. The chain builds across the "
            "screen as a flowing 3D ribbon of connected words. Stop "
            "whenever the connection feels too obvious — or too weird."
        ),
    },
]


def get_game(game_id):
    for g in GAMES:
        if g["id"] == game_id:
            return g
    return None


def games_by_intensity():
    """Group games by intensity for filter chips."""
    groups = {"seated": [], "standing": []}
    for g in GAMES:
        groups.setdefault(g["intensity"], []).append(g)
    return groups
