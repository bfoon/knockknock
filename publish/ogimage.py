"""
The picture that shows up when someone pastes the link into LinkedIn.

Rendered on the server so a dataset with no cover photo still looks deliberate
rather than like a broken link. 1200x630, cached to the publication's og_image
field the first time it is asked for.
"""

import io
import textwrap

from django.core.files.base import ContentFile

W, H = 1200, 630
INK = (16, 20, 24)
PAPER = (246, 247, 245)
SEAL = (31, 107, 78)
OCHRE = (180, 118, 42)
MUTED = (108, 116, 112)

FONT_CANDIDATES = {
    "serif": [
        "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
        "/System/Library/Fonts/Supplemental/Georgia Bold.ttf",
    ],
    "sans": [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ],
    "sans-bold": [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ],
}


def _font(role, size):
    from PIL import ImageFont
    for path in FONT_CANDIDATES.get(role, []):
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    try:
        return ImageFont.load_default(size)
    except Exception:
        return ImageFont.load_default()


def render(publication):
    """Return PNG bytes."""
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(img)

    # A single ink band down the left edge, keyed to the kind. This is the only
    # decoration on the card; everything else is type.
    band = {"dataset": SEAL, "article": INK, "deck": OCHRE,
            "board": (36, 62, 54), "card": (150, 60, 70), "show": (58, 70, 120)}
    d.rectangle([0, 0, 18, H], fill=band.get(publication.kind, INK))

    pad = 78
    y = 74

    kind = _font("sans-bold", 25)
    d.text((pad, y), publication.kind_label, font=kind, fill=band.get(publication.kind, INK))
    key = _font("sans", 25)
    keytext = publication.citation_key + ("  ·  v%d" % publication.version if publication.version > 1 else "")
    d.text((W - pad - d.textlength(keytext, font=key), y), keytext, font=key, fill=MUTED)
    y += 58
    d.line([pad, y, W - pad, y], fill=(220, 224, 218), width=2)
    y += 44

    title = publication.title.strip()
    size = 74 if len(title) < 60 else (60 if len(title) < 100 else 50)
    tf = _font("serif", size)
    wrap = 34 if size == 74 else (42 if size == 60 else 50)
    lines = textwrap.wrap(title, width=wrap)[:4]
    for line in lines:
        d.text((pad, y), line, font=tf, fill=INK)
        y += int(size * 1.22)

    if publication.subtitle and y < H - 220:
        sf = _font("sans", 30)
        for line in textwrap.wrap(publication.subtitle, width=70)[:2]:
            d.text((pad, y + 10), line, font=sf, fill=MUTED)
            y += 42

    foot = _font("sans-bold", 28)
    d.text((pad, H - 96), publication.author_line()[:64], font=foot, fill=INK)
    mark = _font("sans", 26)
    d.text((pad, H - 56), "KnockKnock", font=mark, fill=MUTED)

    stat = _stat_line(publication)
    if stat:
        sf = _font("sans", 26)
        d.text((W - pad - d.textlength(stat, font=sf), H - 56), stat, font=sf, fill=MUTED)

    out = io.BytesIO()
    img.save(out, format="PNG", optimize=True)
    return out.getvalue()


def _stat_line(publication):
    meta = publication.meta or {}
    if publication.kind == "dataset" and meta.get("rows"):
        return "%s rows · %s variables" % (f"{meta['rows']:,}", meta.get("variables") or meta.get("columns", ""))
    if publication.kind == "deck" and meta.get("slides"):
        return "%d slides" % meta["slides"]
    if publication.kind == "board" and meta.get("pages"):
        return "%d pages" % meta["pages"]
    if publication.kind == "card" and meta.get("message_count"):
        return "%d messages" % meta["message_count"]
    if publication.reading_seconds:
        return "%d min read" % max(1, round(publication.reading_seconds / 60))
    return ""


def ensure(publication, force=False):
    """Render once and keep it. Returns the stored file or None if Pillow is absent."""
    if publication.og_image and not force:
        return publication.og_image
    try:
        data = render(publication)
    except Exception:
        return None
    publication.og_image.save("og-%s-v%d.png" % (publication.slug[:50], publication.version),
                              ContentFile(data), save=False)
    publication.save(update_fields=["og_image"])
    return publication.og_image
