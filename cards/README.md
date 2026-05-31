# cards — Digital Group Cards for KnockKnock

A Django app for creating shareable digital cards (thank you, goodbye, love you,
birthday, get well, and more). People scan a QR code or open a link, write a
message, and it appears **instantly** on a live "wall" rendered in a handwriting
font on tilted sticky notes. The recipient's photo sits centre-top; messages flow
in below. The organiser can end the session and download the whole card as a PDF.

## Features
- 10 occasions + 6 creative templates (each with its own palette, handwriting font, motif).
- **Background gallery** — a visual picker on both the create and manage pages with:
  - watercolour florals (themed per template),
  - 8 fun patterns: hearts, music notes, stars, confetti, balloons, polka dots, waves, bubbles,
  - plain paper, and
  - a custom-image upload that replaces the background everywhere.
  The chosen background renders on the sign page, the live wall, and the PDF.
- Public QR / link page for contributors — no login required to sign.
- **Emoji reactions** — anyone can tap ❤️ 🎉 👏 😂 🥳 🔥 on the wall; each tap drops
  another emoji into a growing pile clustered under the recipient's photo (a
  "pebble base"). Reactions poll in live alongside messages and are disabled once
  the card is closed.
- Live wall that auto-updates every 3 seconds (polling `feed/`), with pop-in animation.
- **Scrollable wall** — the header (photo, pile, reaction bar, buttons) stays fixed
  while the messages scroll, so a busy card never overflows the viewport.
- **Creator-only download** — the Download PDF button on the wall shows only to the
  card's creator; contributors who scan the QR can view everything but not download.
- Recipient photo centre-top, organiser intro note, 6 sticky-note tints.
- Optional moderation (approve messages before they show).
- End-session (read-only) + PDF download (pure ReportLab — no native libraries).
- Organiser dashboard: copy share link, QR PNG, change background, manage/approve/delete messages.

## How backgrounds work
The background system has four modes stored on `Card.background_mode`:
`floral` (default), `pattern` (with `background_pattern` holding the pattern id),
`solid`, and `custom` (uses the uploaded `custom_background` image). Rendering is
shared across the web and the PDF:
- `static/cards/js/backgrounds.js` is the single source of truth for the fun
  patterns — it both renders the picker swatches and paints the full-page
  background on the live pages. `BG_PATTERNS` in `models.py` mirrors it for the PDF.
- `static/cards/js/floral.js` paints the watercolour florals (themed by the
  template's `floral` palette).
- `_bgpicker.html` + `picker.js` are the visual picker; selection writes to the
  hidden `background_mode` / `background_pattern` inputs.
- `_background.html` chooses the right layer at render time via
  `Card.effective_background_mode` (which falls back to florals if a custom
  image or pattern id is missing, so a card never renders blank).
- The PDF (`views.download_pdf`) redraws florals/patterns with ReportLab, or
  embeds the custom image full-page.

To add a new pattern: add it to `BG_PATTERNS` in **both** `backgrounds.js` and
`models.py` (same id + colours), and add a drawing routine in `draw_pattern`
inside `views.download_pdf` if you want it in the PDF too.

## Install into your `knockknock` project

1. Copy the `cards/` folder into your project root (next to `manage.py`).

2. Add to `INSTALLED_APPS` in `settings.py`:
   ```python
   INSTALLED_APPS = [
       # ...
       "cards",
   ]
   ```
   Ensure media + static are configured (for the recipient photo & QR):
   ```python
   MEDIA_URL = "/media/"
   MEDIA_ROOT = BASE_DIR / "media"
   ```

3. Include the URLs in your root `urls.py`:
   ```python
   from django.conf import settings
   from django.conf.urls.static import static
   from django.urls import include, path

   urlpatterns = [
       # ...
       path("cards/", include("cards.urls", namespace="cards")),
   ]
   if settings.DEBUG:
       urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
   ```

4. Install dependencies:
   ```bash
   pip install Pillow qrcode weasyprint
   ```
   - `Pillow` — image uploads (already required by most Django projects)
   - `qrcode` — QR PNG generation
   - `weasyprint` — PDF export (optional; the PDF route returns a friendly
     501 with install instructions if it's missing)

5. Migrate:
   ```bash
   python manage.py migrate cards
   ```

## URLs
| Name | Path | Who |
|------|------|-----|
| `cards:my_cards` | `/cards/` | organiser |
| `cards:create` | `/cards/new/` | organiser |
| `cards:detail` | `/cards/c/<token>/manage/` | organiser |
| `cards:post` | `/cards/c/<token>/` | **public (QR/link target)** |
| `cards:view` | `/cards/c/<token>/wall/` | public live wall |
| `cards:feed` | `/cards/c/<token>/feed/` | JSON polling feed |
| `cards:qr` | `/cards/c/<token>/qr.png` | QR image |
| `cards:pdf` | `/cards/c/<token>/download.pdf` | PDF export |
| `cards:close` | `/cards/c/<token>/close/` | end session |

The QR code encodes the **post** URL, so scanning drops people straight onto the
"write a message" page.

## Notes
- The live wall uses lightweight polling (no Channels needed). If you'd rather use
  Django Channels / WebSockets (you already run Channels in EasyOffice/UNPASS), the
  `feed/` view can be swapped for a consumer broadcasting on message save.
- Templates use the `eo-*` class convention to match your existing design system,
  but the app is fully self-contained (`cards.css`) and has no external CSS deps
  besides Google Fonts for the handwriting faces.
