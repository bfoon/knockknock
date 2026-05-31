import uuid

from django.conf import settings
from django.db import models
from django.urls import reverse
from django.utils import timezone


class CardOccasion(models.TextChoices):
    THANK_YOU = "thank_you", "Thank You"
    GOODBYE = "goodbye", "Goodbye / Farewell"
    LOVE_YOU = "love_you", "Love You"
    CONGRATS = "congrats", "Congratulations"
    GET_WELL = "get_well", "Get Well Soon"
    BIRTHDAY = "birthday", "Happy Birthday"
    WELCOME = "welcome", "Welcome Aboard"
    SYMPATHY = "sympathy", "With Sympathy"
    GOOD_LUCK = "good_luck", "Good Luck"
    APPRECIATION = "appreciation", "Appreciation"


# Each template defines a colour palette + handwriting font + decorative motif,
# plus a `floral` palette used to paint the watercolour SVG background.
# The floral keys: paper/paper2 (background + vignette), pL/p/pD (petal light/
# mid/deep), ctr/ctrS (stamen + soft centre), lL/l/lD (leaf light/mid/deep).
CARD_TEMPLATES = {
    "sunset_bloom": {
        "name": "Sunset Bloom",
        "font": "'Caveat', cursive",
        "bg": "linear-gradient(135deg,#ff9a9e 0%,#fad0c4 50%,#fecfef 100%)",
        "ink": "#7a2c4d",
        "accent": "#d6336c",
        "motif": "🌸",
        "floral": {
            "paper": "#f5f1ea", "paper2": "#ece1d4",
            "pL": "#f3dde0", "p": "#e3a9b3", "pD": "#c66e80",
            "ctr": "#a8324a", "ctrS": "#edd0ae",
            "lL": "#bcc48d", "l": "#8f9d5a", "lD": "#5f6d36",
        },
    },
    "midnight_glow": {
        "name": "Midnight Glow",
        "font": "'Dancing Script', cursive",
        "bg": "linear-gradient(135deg,#0f2027 0%,#203a43 50%,#2c5364 100%)",
        "ink": "#e8f1f2",
        "accent": "#64ffda",
        "motif": "✨",
        "floral": {
            "paper": "#16202b", "paper2": "#0d1620",
            "pL": "#3a5a6b", "p": "#4f8a9c", "pD": "#64ffda",
            "ctr": "#9ff7e4", "ctrS": "#2a4a55",
            "lL": "#4a6a64", "l": "#3a7d6e", "lD": "#245046",
        },
    },
    "paper_craft": {
        "name": "Paper Craft",
        "font": "'Shadows Into Light', cursive",
        "bg": "linear-gradient(135deg,#fdfcfb 0%,#e2d1c3 100%)",
        "ink": "#5b4636",
        "accent": "#c0865d",
        "motif": "📜",
        "floral": {
            "paper": "#f8f2e6", "paper2": "#ece0cd",
            "pL": "#f0ddc4", "p": "#d8b48a", "pD": "#bd8b5a",
            "ctr": "#8a5a30", "ctrS": "#ecd9b8",
            "lL": "#c3bd95", "l": "#9c9466", "lD": "#6a6340",
        },
    },
    "ocean_breeze": {
        "name": "Ocean Breeze",
        "font": "'Patrick Hand', cursive",
        "bg": "linear-gradient(135deg,#a1c4fd 0%,#c2e9fb 100%)",
        "ink": "#194a6b",
        "accent": "#0077b6",
        "motif": "🌊",
        "floral": {
            "paper": "#eef4f8", "paper2": "#dce8f0",
            "pL": "#d6e8f5", "p": "#8fbfe0", "pD": "#4f93c4",
            "ctr": "#1f6aa3", "ctrS": "#e0eaf0",
            "lL": "#a7c0bb", "l": "#6f9b94", "lD": "#456862",
        },
    },
    "golden_hour": {
        "name": "Golden Hour",
        "font": "'Kalam', cursive",
        "bg": "linear-gradient(135deg,#f6d365 0%,#fda085 100%)",
        "ink": "#6b3f1d",
        "accent": "#e8590c",
        "motif": "🌟",
        "floral": {
            "paper": "#f8f2e6", "paper2": "#f0e3c8",
            "pL": "#fbe7c4", "p": "#f3c275", "pD": "#e0963f",
            "ctr": "#b85c1a", "ctrS": "#f5e0b0",
            "lL": "#c3c283", "l": "#9a9a4e", "lD": "#69692f",
        },
    },
    "lavender_fields": {
        "name": "Lavender Fields",
        "font": "'Gochi Hand', cursive",
        "bg": "linear-gradient(135deg,#d4a5f9 0%,#e0c3fc 50%,#8ec5fc 100%)",
        "ink": "#4a306d",
        "accent": "#7048e8",
        "motif": "💜",
        "floral": {
            "paper": "#f3f0f7", "paper2": "#e4ddf0",
            "pL": "#e6dcf5", "p": "#c3a9e0", "pD": "#9b78c9",
            "ctr": "#6f4aa3", "ctrS": "#e9d8b8",
            "lL": "#aeb9a0", "l": "#7e9072", "lD": "#52624a",
        },
    },
}

TEMPLATE_CHOICES = [(k, v["name"]) for k, v in CARD_TEMPLATES.items()]


# Python mirror of the JS background catalogue (static/cards/js/backgrounds.js).
# Keep the ids + colours in sync; the PDF renderer reads from here, the web UI
# reads from the JS. `kind` selects the drawing routine; `bg` is the page fill;
# `icons` are the motif colours; `group` drives the picker section headers.
BG_PATTERNS = {
    "hearts_love":   {"name": "Hearts", "group": "Love & cute", "kind": "hearts",
                      "bg": "#fff0f3", "icons": ["#ff8fab", "#ffb3c6", "#fb6f92", "#ffc2d1"]},
    "music_party":   {"name": "Music notes", "group": "Fun & playful", "kind": "music",
                      "bg": "#f3efff", "icons": ["#9b8cff", "#b9aaff", "#7c6cf0", "#cdb8ff"]},
    "starry_joy":    {"name": "Stars", "group": "Fun & playful", "kind": "stars",
                      "bg": "#fff8e6", "icons": ["#ffd43b", "#ffc078", "#ffe066", "#fcc419"]},
    "confetti_pop":  {"name": "Confetti", "group": "Festive", "kind": "confetti",
                      "bg": "#eefcf5", "icons": ["#ff8fab", "#ffd43b", "#74c0fc", "#b2f2bb", "#ffa94d", "#da77f2"]},
    "balloons_fest": {"name": "Balloons", "group": "Festive", "kind": "balloons",
                      "bg": "#fff4ee", "icons": ["#ff922b", "#ff6b6b", "#ffd43b", "#69db7c", "#4dabf7"]},
    "polka_dots":    {"name": "Polka dots", "group": "Geometric", "kind": "dots",
                      "bg": "#e7f9ff", "icons": ["#4dabf7", "#74c0fc", "#a5d8ff", "#3bc9db"]},
    "ocean_waves":   {"name": "Waves", "group": "Geometric", "kind": "waves",
                      "bg": "#e3f7fb", "icons": ["#3bc9db", "#66d9e8", "#22b8cf"]},
    "bubbly":        {"name": "Bubbles", "group": "Geometric", "kind": "bubbles",
                      "bg": "#eafff3", "icons": ["#69db7c", "#8ce99a", "#38d9a9", "#b2f2bb"]},
}


class Card(models.Model):
    """A digital group card that many people can post messages to."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # Short, URL-friendly token used in public links / QR codes.
    token = models.CharField(max_length=12, unique=True, db_index=True, editable=False)

    title = models.CharField(max_length=140)
    recipient_name = models.CharField(max_length=120)
    occasion = models.CharField(
        max_length=20, choices=CardOccasion.choices, default=CardOccasion.THANK_YOU
    )
    template = models.CharField(
        max_length=30, choices=TEMPLATE_CHOICES, default="sunset_bloom"
    )

    # Background style:
    #   "floral"  → themed watercolour SVG (default)
    #   "pattern" → one of the named fun patterns (hearts, music, confetti…),
    #               stored in `background_pattern`
    #   "solid"   → the template's flat paper colour, no decoration
    #   "custom"  → the uploaded `custom_background` image
    BACKGROUND_FLORAL = "floral"
    BACKGROUND_PATTERN = "pattern"
    BACKGROUND_SOLID = "solid"
    BACKGROUND_CUSTOM = "custom"
    BACKGROUND_CHOICES = [
        (BACKGROUND_FLORAL, "Watercolour florals"),
        (BACKGROUND_PATTERN, "Fun pattern"),
        (BACKGROUND_SOLID, "Plain paper"),
        (BACKGROUND_CUSTOM, "Custom image"),
    ]
    background_mode = models.CharField(
        max_length=10, choices=BACKGROUND_CHOICES, default=BACKGROUND_FLORAL
    )
    # The chosen pattern id (e.g. "hearts_love") when background_mode=="pattern".
    # Validated loosely as a slug; the catalogue lives in backgrounds.js + the
    # Python mirror BG_PATTERNS below.
    background_pattern = models.CharField(max_length=32, blank=True, default="")
    # When background_mode == "custom", this image replaces the default
    # background everywhere the card is shown.
    custom_background = models.ImageField(
        upload_to="cards/backgrounds/%Y/%m/", blank=True, null=True
    )

    # Photo shown centre-top of the card.
    recipient_photo = models.ImageField(
        upload_to="cards/photos/%Y/%m/", blank=True, null=True
    )

    intro_note = models.TextField(
        blank=True,
        help_text="Optional note from the organiser shown under the photo.",
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="cards_created",
    )

    # Once closed, no further messages can be posted.
    is_closed = models.BooleanField(default=False)
    # Require organiser approval before a message appears (optional moderation).
    moderated = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)
    closed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.title} ({self.get_occasion_display()})"

    def save(self, *args, **kwargs):
        if not self.token:
            self.token = uuid.uuid4().hex[:10]
        super().save(*args, **kwargs)

    def close(self):
        self.is_closed = True
        self.closed_at = timezone.now()
        self.save(update_fields=["is_closed", "closed_at"])

    @property
    def template_config(self):
        return CARD_TEMPLATES.get(self.template, CARD_TEMPLATES["sunset_bloom"])

    @property
    def floral_palette(self):
        return self.template_config.get("floral", CARD_TEMPLATES["sunset_bloom"]["floral"])

    @property
    def use_custom_background(self):
        return self.background_mode == self.BACKGROUND_CUSTOM and bool(self.custom_background)

    @property
    def custom_background_url(self):
        return self.custom_background.url if self.use_custom_background else ""

    @property
    def pattern_config(self):
        """The chosen fun-pattern config dict, or None if not in pattern mode
        (or the stored id is unknown)."""
        if self.background_mode == self.BACKGROUND_PATTERN:
            return BG_PATTERNS.get(self.background_pattern)
        return None

    @property
    def effective_background_mode(self):
        """Resolve the mode actually used for rendering, applying fallbacks:
        custom-without-image and pattern-without-valid-id both fall back to
        florals so a card is never left with a blank background."""
        if self.background_mode == self.BACKGROUND_CUSTOM and not self.custom_background:
            return self.BACKGROUND_FLORAL
        if self.background_mode == self.BACKGROUND_PATTERN and not self.pattern_config:
            return self.BACKGROUND_FLORAL
        return self.background_mode

    @property
    def visible_messages(self):
        qs = self.messages.all()
        if self.moderated:
            qs = qs.filter(is_approved=True)
        return qs

    def get_absolute_url(self):
        return reverse("cards:detail", args=[self.token])

    def get_post_url(self):
        return reverse("cards:post", args=[self.token])

    def get_view_url(self):
        return reverse("cards:view", args=[self.token])


# A small palette of sticky-note tints contributors can pick from.
NOTE_COLORS = [
    ("mint", "Mint"),
    ("peach", "Peach"),
    ("sky", "Sky"),
    ("lemon", "Lemon"),
    ("rose", "Rose"),
    ("lilac", "Lilac"),
]


class Message(models.Model):
    """A single hand-written-style message posted to a card."""

    card = models.ForeignKey(Card, on_delete=models.CASCADE, related_name="messages")
    author_name = models.CharField(max_length=80, default="Anonymous")
    body = models.TextField(max_length=600)
    color = models.CharField(max_length=10, choices=NOTE_COLORS, default="mint")
    # Slight random tilt for the scrapbook effect (-6..6 degrees), set on create.
    tilt = models.SmallIntegerField(default=0)

    is_approved = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.author_name} → {self.card.recipient_name}"

    def save(self, *args, **kwargs):
        if not self.pk and not self.tilt:
            import random

            self.tilt = random.randint(-6, 6)
        super().save(*args, **kwargs)


# The fixed set of emoji contributors can send. Stored as the literal emoji so
# rendering needs no lookup table; validated against this allow-list on POST.
# Keep in sync with the vector look-alikes in cards/pdf_emoji.py.
REACTION_EMOJI = ["❤️", "🎉", "👏", "😂", "🥳", "🔥", "😢", "😭", "🕯️"]


class Reaction(models.Model):
    """A single emoji tap on a card. Each tap is its own row so the wall can
    show a growing pile under the recipient photo."""

    card = models.ForeignKey(
        Card, on_delete=models.CASCADE, related_name="reactions"
    )
    emoji = models.CharField(max_length=8)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return f"{self.emoji} on {self.card.token}"