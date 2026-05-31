import io

from collections import Counter

from django.contrib import messages as flash
from django.contrib.auth.decorators import login_required
from django.http import HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.http import require_POST

import json

from .forms import CardForm, MessageForm
from .models import (
    BG_PATTERNS,
    CARD_TEMPLATES,
    REACTION_EMOJI,
    Card,
    Message,
    Reaction,
)


# --------------------------------------------------------------------------- #
#  Organiser flows
# --------------------------------------------------------------------------- #
@login_required
def create(request):
    if request.method == "POST":
        form = CardForm(request.POST, request.FILES)
        if form.is_valid():
            card = form.save(commit=False)
            card.created_by = request.user
            card.save()
            flash.success(request, "Your card is live! Share the link or QR code.")
            return redirect("cards:detail", token=card.token)
    else:
        form = CardForm()
    default_floral = CARD_TEMPLATES["sunset_bloom"]["floral"]
    return render(
        request,
        "cards/create.html",
        {
            "form": form,
            "templates_json": json.dumps(CARD_TEMPLATES),
            "floral_palette": default_floral,
        },
    )


@login_required
def detail(request, token):
    """Organiser dashboard for one card: share links, QR, moderation, close."""
    card = get_object_or_404(Card, token=token)
    if card.created_by_id != request.user.id and not request.user.is_superuser:
        flash.error(request, "You don't have access to manage this card.")
        return redirect("cards:my_cards")
    share_url = request.build_absolute_uri(card.get_post_url())
    return render(
        request,
        "cards/detail.html",
        {
            "card": card,
            "share_url": share_url,
            "messages_list": card.messages.all(),
            "floral_palette": card.floral_palette,
        },
    )


@login_required
@require_POST
def update_background(request, token):
    """Update just the background (mode / pattern / custom image) of a card
    from the manage page's Appearance panel."""
    card = get_object_or_404(Card, token=token)
    if card.created_by_id != request.user.id and not request.user.is_superuser:
        flash.error(request, "You don't have access to manage this card.")
        return redirect("cards:my_cards")

    mode = request.POST.get("background_mode") or Card.BACKGROUND_FLORAL
    pattern = request.POST.get("background_pattern") or ""
    if mode not in dict(Card.BACKGROUND_CHOICES):
        mode = Card.BACKGROUND_FLORAL

    if request.FILES.get("custom_background"):
        card.custom_background = request.FILES["custom_background"]

    # Apply the same guards as the form so we never store a blank background.
    if mode == Card.BACKGROUND_CUSTOM and not card.custom_background:
        mode = Card.BACKGROUND_FLORAL
    if mode == Card.BACKGROUND_PATTERN and pattern not in BG_PATTERNS:
        mode = Card.BACKGROUND_FLORAL
        pattern = ""

    card.background_mode = mode
    card.background_pattern = pattern if mode == Card.BACKGROUND_PATTERN else ""
    card.save(update_fields=["background_mode", "background_pattern", "custom_background"])
    flash.success(request, "Background updated ✨")
    return redirect("cards:detail", token=card.token)


@login_required
def my_cards(request):
    cards = Card.objects.filter(created_by=request.user)
    return render(request, "cards/my_cards.html", {"cards": cards})


@login_required
@require_POST
def close_card(request, token):
    card = get_object_or_404(Card, token=token, created_by=request.user)
    card.close()
    flash.info(request, "Card session ended. It's now read-only.")
    return redirect("cards:view", token=card.token)


@login_required
@require_POST
def delete_card(request, token):
    card = get_object_or_404(Card, token=token, created_by=request.user)
    title = card.title
    card.delete()
    flash.success(request, f"Deleted “{title}”.")
    next_url = request.POST.get("next") or reverse("cards:my_cards")
    return redirect(next_url)


@login_required
@require_POST
def moderate_message(request, token, pk):
    card = get_object_or_404(Card, token=token, created_by=request.user)
    msg = get_object_or_404(Message, pk=pk, card=card)
    action = request.POST.get("action")
    if action == "approve":
        msg.is_approved = True
        msg.save(update_fields=["is_approved"])
    elif action == "delete":
        msg.delete()
    return redirect("cards:detail", token=card.token)


def qr_code(request, token):
    """Render a PNG QR code that links to the public post page."""
    import qrcode

    card = get_object_or_404(Card, token=token)
    url = request.build_absolute_uri(card.get_post_url())
    img = qrcode.make(url, box_size=10, border=2)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return HttpResponse(buf.getvalue(), content_type="image/png")


# --------------------------------------------------------------------------- #
#  Public flows (QR / link)
# --------------------------------------------------------------------------- #
def post_message(request, token):
    """Public page where contributors write a message (reached via QR/link)."""
    card = get_object_or_404(Card, token=token)
    if card.is_closed:
        return render(request, "cards/closed.html", {"card": card})

    if request.method == "POST":
        form = MessageForm(request.POST)
        if form.is_valid():
            msg = form.save(commit=False)
            msg.card = card
            msg.is_approved = not card.moderated
            msg.save()
            if request.headers.get("x-requested-with") == "XMLHttpRequest":
                return JsonResponse(
                    {
                        "ok": True,
                        "moderated": card.moderated,
                        "message": {
                            "author": msg.author_name,
                            "body": msg.body,
                            "color": msg.color,
                            "tilt": msg.tilt,
                        },
                    }
                )
            flash.success(request, "Your message has been added 💌")
            return redirect("cards:view", token=card.token)
    else:
        form = MessageForm()
    return render(request, "cards/post.html", {"card": card, "form": form})


def view_card(request, token):
    """The big live wall — photo on top, messages flowing in below."""
    card = get_object_or_404(Card, token=token)
    is_owner = bool(
        request.user.is_authenticated
        and (card.created_by_id == request.user.id or request.user.is_superuser)
    )
    # Per-emoji totals so the owner sees a running count on each bar button.
    counts = Counter(card.reactions.values_list("emoji", flat=True))
    reaction_bar = [{"emoji": e, "count": counts.get(e, 0)} for e in REACTION_EMOJI]
    return render(
        request,
        "cards/view.html",
        {
            "card": card,
            "is_owner": is_owner,
            "reaction_emoji": REACTION_EMOJI,
            "reaction_bar": reaction_bar,
        },
    )


def live_messages(request, token):
    """JSON feed polled by the live wall to show new messages instantly."""
    card = get_object_or_404(Card, token=token)
    since = request.GET.get("since")
    qs = card.visible_messages.order_by("created_at")
    if since:
        try:
            dt = timezone.datetime.fromisoformat(since)
            qs = qs.filter(created_at__gt=dt)
        except (ValueError, TypeError):
            pass
    data = [
        {
            "id": m.id,
            "author": m.author_name,
            "body": m.body,
            "color": m.color,
            "tilt": m.tilt,
            "created_at": m.created_at.isoformat(),
        }
        for m in qs
    ]
    # Reactions: send the full ordered list (ids + emoji) so the wall can build
    # the pile and animate new taps. The list is small (one short string each).
    reactions = [
        {"id": rx.id, "emoji": rx.emoji}
        for rx in card.reactions.order_by("created_at")
    ]
    return JsonResponse(
        {
            "messages": data,
            "is_closed": card.is_closed,
            "count": card.visible_messages.count(),
            "reactions": reactions,
        }
    )


@require_POST
def react(request, token):
    """Public endpoint: drop one emoji onto the card. Validated against the
    fixed allow-list; ignored once the card is closed."""
    card = get_object_or_404(Card, token=token)
    if card.is_closed:
        return JsonResponse({"ok": False, "reason": "closed"}, status=409)
    emoji = (request.POST.get("emoji") or "").strip()
    if emoji not in REACTION_EMOJI:
        return JsonResponse({"ok": False, "reason": "invalid"}, status=400)
    rx = Reaction.objects.create(card=card, emoji=emoji)
    return JsonResponse({"ok": True, "id": rx.id, "emoji": rx.emoji})


# --------------------------------------------------------------------------- #
#  Download as PDF
# --------------------------------------------------------------------------- #
# The export mirrors the on-screen card as closely as a vector PDF can: the same
# background art (florals / fun pattern / custom image / plain paper), the photo,
# the fanned emoji pile, the occasion chip and title, then every message as a
# tilted sticky note. Layout adapts (columns + font size shrink) so the whole
# card always fits in at most two pages. The emoji *bar* is intentionally never
# drawn — only the emoji pile, exactly like the picture of the card.
def download_pdf(request, token):
    """Render the card to a PDF that matches the on-screen design.

    Built entirely with ReportLab vector primitives (no native libraries):
    the background, the emoji look-alikes (see ``pdf_emoji``) and the sticky
    notes are all drawn, so the output reads like a snapshot of the wall.
    """
    card = get_object_or_404(Card, token=token)

    try:
        from reportlab.lib.colors import HexColor
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.units import mm
        from reportlab.lib.utils import ImageReader
        from reportlab.pdfgen import canvas
    except ImportError:
        return HttpResponse(
            "PDF export requires ReportLab. Install with: pip install reportlab",
            status=501,
        )

    from .pdf_emoji import draw_emoji

    cfg = card.template_config
    fp = card.floral_palette
    msgs = list(card.visible_messages)
    # Reactions in tap order — the pile fans out exactly like the live wall.
    reactions = list(
        card.reactions.order_by("created_at").values_list("emoji", flat=True)
    )

    # Resolve file-system paths for any uploaded images (guard missing files).
    photo_path = None
    if card.recipient_photo:
        try:
            photo_path = card.recipient_photo.path
        except Exception:
            photo_path = None
    custom_bg_path = None
    if card.effective_background_mode == "custom" and card.custom_background:
        try:
            custom_bg_path = card.custom_background.path
        except Exception:
            custom_bg_path = None

    NOTE_FILL = {
        "mint": "#d3f9d8", "peach": "#ffe8cc", "sky": "#d0ebff",
        "lemon": "#fff3bf", "rose": "#ffdeeb", "lilac": "#eebefa",
    }

    # Background scatter shared with the on-screen wall (x%, y%, scale, kind).
    SCATTER = [
        (11, 7, 1.15, "b"), (34, 4, 0.85, "b"), (64, 7, 0.9, "b"), (87, 12, 1.05, "b"),
        (22, 16, 0.8, "l"), (93, 25, 0.85, "l"), (5, 31, 1.05, "b"), (95, 47, 0.95, "b"),
        (6, 63, 0.8, "l"), (91, 65, 1.1, "b"), (12, 78, 1.05, "b"), (88, 83, 0.95, "b"),
        (31, 91, 0.82, "l"), (59, 94, 0.9, "b"), (9, 93, 0.78, "l"), (49, 89, 0.8, "l"),
    ]

    # Layouts ordered roomiest -> densest. The first whose packing fits in two
    # pages wins, so small cards stay big and airy and busy cards shrink to fit.
    LAYOUTS = [
        dict(ncols=2, body=12, lead=15, auth=10, pad=5.0, colgap=8, rowgap=6),
        dict(ncols=2, body=11, lead=13.5, auth=9.5, pad=4.5, colgap=8, rowgap=5),
        dict(ncols=3, body=10, lead=12.5, auth=9, pad=4.0, colgap=7, rowgap=5),
        dict(ncols=3, body=9, lead=11, auth=8, pad=3.5, colgap=6, rowgap=4),
        dict(ncols=4, body=8.5, lead=10.5, auth=7.5, pad=3.2, colgap=6, rowgap=4),
        dict(ncols=4, body=7.5, lead=9, auth=7, pad=2.8, colgap=5, rowgap=3.5),
        dict(ncols=5, body=7, lead=8.5, auth=6.5, pad=2.5, colgap=4.5, rowgap=3),
    ]

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    PAGE_W, PAGE_H = A4
    M = 16 * mm
    ink = HexColor(cfg.get("ink", "#444444"))
    accent = HexColor(cfg.get("accent", "#888888"))

    def wrap(text, font, size, max_w):
        out = []
        for para in (text or "").split("\n"):
            words, cur = para.split(), ""
            if not words:
                out.append("")
                continue
            for w in words:
                trial = (cur + " " + w).strip()
                if c.stringWidth(trial, font, size) <= max_w or not cur:
                    cur = trial
                else:
                    out.append(cur)
                    cur = w
            if cur:
                out.append(cur)
        return out

    # ---- background art (mirrors the on-screen wall) ---------------------- #
    def draw_blossom(cx, cy, s, petal_hex, center_hex):
        import math

        c.setFillColor(HexColor(petal_hex))
        c.setFillAlpha(0.85)
        for k in range(5):
            ang = math.radians(k * 72 - 90)
            c.circle(cx + math.cos(ang) * 5.2 * mm * s,
                     cy + math.sin(ang) * 5.2 * mm * s,
                     3.6 * mm * s, stroke=0, fill=1)
        c.setFillAlpha(1)
        c.setFillColor(HexColor(center_hex))
        c.circle(cx, cy, 1.5 * mm * s, stroke=0, fill=1)

    def draw_leaf(cx, cy, s, leaf_hex):
        c.setFillColor(HexColor(leaf_hex))
        c.setFillAlpha(0.8)
        c.ellipse(cx - 2 * mm * s, cy - 5 * mm * s, cx + 2 * mm * s, cy + 5 * mm * s,
                  stroke=0, fill=1)
        c.setFillAlpha(1)

    def draw_pattern(pat):
        import math

        kind, icons = pat["kind"], pat["icons"]
        c.setFillColor(HexColor(pat["bg"]))
        c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
        c.setFillAlpha(0.85)

        def grid(step, fn):
            step *= mm
            row, yy = 0, step
            while yy < PAGE_H + step:
                coln, xx = 0, (step / 2 if row % 2 else 0)
                while xx < PAGE_W + step:
                    fn(xx, yy, row, coln)
                    xx += step
                    coln += 1
                yy += step
                row += 1

        if kind == "hearts":
            def heart(x, y, r, col):
                c.setFillColor(HexColor(icons[(r * 7 + col * 3) % len(icons)]))
                rad = 2.4 * mm
                c.circle(x - rad * 0.6, y + rad * 0.4, rad * 0.7, stroke=0, fill=1)
                c.circle(x + rad * 0.6, y + rad * 0.4, rad * 0.7, stroke=0, fill=1)
                p = c.beginPath()
                p.moveTo(x - rad * 1.25, y + rad * 0.55)
                p.lineTo(x + rad * 1.25, y + rad * 0.55)
                p.lineTo(x, y - rad * 1.1)
                p.close()
                c.drawPath(p, stroke=0, fill=1)
            grid(15, heart)
        elif kind == "dots":
            def dot(x, y, r, col):
                c.setFillColor(HexColor(icons[(r + col) % len(icons)]))
                c.circle(x, y, (1.7 if (r + col) % 2 else 1.1) * mm, stroke=0, fill=1)
            grid(11, dot)
        elif kind == "stars":
            def star(x, y, r, col):
                c.setFillColor(HexColor(icons[(r * 3 + col * 5) % len(icons)]))
                pts, rr = [], 2.4 * mm
                for i in range(5):
                    a = math.radians(i * 144 - 90)
                    pts.append((x + math.cos(a) * rr, y + math.sin(a) * rr))
                p = c.beginPath()
                p.moveTo(*pts[0])
                for pt in pts[1:]:
                    p.lineTo(*pt)
                p.close()
                c.drawPath(p, stroke=0, fill=1)
            grid(16, star)
        elif kind == "music":
            def note(x, y, r, col):
                c.setFillColor(HexColor(icons[(r * 5 + col * 3) % len(icons)]))
                c.ellipse(x - 1.5 * mm, y - 1.1 * mm, x + 1.5 * mm, y + 1.1 * mm,
                          stroke=0, fill=1)
                c.rect(x + 1.0 * mm, y, 0.5 * mm, 5 * mm, stroke=0, fill=1)
            grid(16, note)
        elif kind == "balloons":
            def bal(x, y, r, col):
                hexcol = icons[(r * 3 + col) % len(icons)]
                c.setFillColor(HexColor(hexcol))
                c.ellipse(x - 2.6 * mm, y - 3.2 * mm, x + 2.6 * mm, y + 3.2 * mm,
                          stroke=0, fill=1)
                c.setStrokeColor(HexColor(hexcol))
                c.setLineWidth(0.4)
                c.line(x, y - 3.2 * mm, x, y - 8 * mm)
            grid(20, bal)
        elif kind == "waves":
            step = 12 * mm
            yy, row = step, 0
            while yy < PAGE_H + step:
                c.setStrokeColor(HexColor(icons[row % len(icons)]))
                c.setLineWidth(1.1)
                c.setStrokeAlpha(0.7)
                path = c.beginPath()
                path.moveTo(0, yy)
                xx = 0
                while xx <= PAGE_W:
                    path.curveTo(xx + 4 * mm, yy + 4 * mm, xx + 8 * mm, yy + 4 * mm,
                                 xx + 12 * mm, yy)
                    xx += 12 * mm
                c.drawPath(path, stroke=1, fill=0)
                yy += step
                row += 1
            c.setStrokeAlpha(1)
        elif kind in ("bubbles", "confetti"):
            import random as _r

            rndp = _r.Random(7 if kind == "bubbles" else 42)
            n = int(PAGE_W * PAGE_H / (2600 * mm * mm)) if kind == "bubbles" \
                else int(PAGE_W * PAGE_H / (1600 * mm * mm))
            for _ in range(max(n, 30)):
                x, y = rndp.random() * PAGE_W, rndp.random() * PAGE_H
                c.setFillColor(HexColor(icons[int(rndp.random() * len(icons))]))
                if kind == "bubbles":
                    c.setFillAlpha(0.5)
                    c.circle(x, y, (rndp.random() * 4 + 1.5) * mm, stroke=0, fill=1)
                else:
                    c.setFillAlpha(0.9)
                    c.circle(x, y, 1.1 * mm, stroke=0, fill=1)
        c.setFillAlpha(1)

    def paint_bg():
        mode = card.effective_background_mode
        if mode == "custom" and custom_bg_path:
            try:
                c.drawImage(ImageReader(custom_bg_path), 0, 0, PAGE_W, PAGE_H,
                            preserveAspectRatio=False, mask="auto")
                return
            except Exception:
                pass
        if mode == "pattern" and card.pattern_config:
            draw_pattern(card.pattern_config)
            return
        # floral or solid -> paper fill, with florals scattered when floral.
        c.setFillColor(HexColor(fp["paper"]))
        c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
        if mode == "floral":
            for x, y, s, kind in SCATTER:
                px, py = x / 100 * PAGE_W, (1 - y / 100) * PAGE_H
                if kind == "b":
                    draw_blossom(px, py, s, fp["p"], fp["ctr"])
                else:
                    draw_leaf(px, py, s, fp["l"])

    # ---- emoji pile (fanned under the photo, mirrors wall.js placement) --- #
    def draw_emoji_pile(cx, top_y):
        if not reactions:
            return
        base = 3.1 * mm
        spread = 46 * mm
        for idx, emoji in enumerate(reactions[:80]):
            seed = (idx * 2654435761) % 1000 / 1000.0
            seed2 = (idx * 40503) % 1000 / 1000.0
            x = cx + (seed - 0.5) * spread
            yy = top_y - seed2 * 8 * mm
            rot = (seed - 0.5) * 36
            scale = 0.8 + seed2 * 0.4
            draw_emoji(c, emoji, x, yy, base * scale, rot=rot)

    # ---- header (photo + pile + chip + title), floating like the wall ----- #
    def draw_header():
        photo_d = 30 * mm
        photo_r = photo_d / 2
        cx = PAGE_W / 2
        photo_cy = PAGE_H - M - photo_r

        note_lines = wrap(card.intro_note, "Helvetica-Oblique", 10,
                          PAGE_W - 2 * M - 24 * mm) if card.intro_note else []
        title_lines = wrap(card.title, "Helvetica-Bold", 22, PAGE_W - 2 * M - 16 * mm)

        chip_y = photo_cy - photo_r - 16 * mm
        title_top = chip_y - 9 * mm
        block_bottom = (title_top - len(title_lines) * 26 - 14
                        - (len(note_lines) * 13 + 6 if note_lines else 0))

        # Soft readability scrim behind the header block (over busy art).
        scrim_top = photo_cy + photo_r + 3 * mm
        scrim_bot = block_bottom - 6 * mm
        c.setFillColor(HexColor("#ffffff"))
        c.setFillAlpha(0.42)
        c.roundRect(M, scrim_bot, PAGE_W - 2 * M, scrim_top - scrim_bot, 14,
                    stroke=0, fill=1)
        c.setFillAlpha(1)

        # Photo (circular) or a soft placeholder showing the recipient initial.
        drew = False
        if photo_path:
            try:
                img = ImageReader(photo_path)
                c.saveState()
                p = c.beginPath()
                p.circle(cx, photo_cy, photo_r)
                c.clipPath(p, stroke=0, fill=0)
                c.drawImage(img, cx - photo_r, photo_cy - photo_r, photo_d, photo_d,
                            preserveAspectRatio=True, mask="auto")
                c.restoreState()
                drew = True
            except Exception:
                drew = False
        if not drew:
            # Tinted disc + the recipient's first initial in the template ink
            # (ReportLab can't render the colour-emoji motif, so we avoid it).
            c.setFillColor(HexColor(fp.get("pL", "#ffffff")))
            c.circle(cx, photo_cy, photo_r, stroke=0, fill=1)
            initial = (card.recipient_name or "?").strip()[:1].upper() or "?"
            c.setFillColor(ink)
            c.setFont("Helvetica-Bold", 26)
            c.drawCentredString(cx, photo_cy - 9, initial)
        c.setStrokeColor(HexColor("#ffffff"))
        c.setLineWidth(3)
        c.circle(cx, photo_cy, photo_r, stroke=1, fill=0)

        # Emoji pile, fanned just under the photo.
        draw_emoji_pile(cx, photo_cy - photo_r - 1.0 * mm)

        # Occasion chip pill (accent fill, white text).
        occ = card.get_occasion_display().upper()
        cw = c.stringWidth(occ, "Helvetica-Bold", 9) + 16
        c.setFillColor(accent)
        c.roundRect(cx - cw / 2, chip_y - 2, cw, 16, 8, stroke=0, fill=1)
        c.setFillColor(HexColor("#ffffff"))
        c.setFont("Helvetica-Bold", 9)
        c.drawCentredString(cx, chip_y + 3, occ)

        # Title (template ink) + recipient line + optional intro note.
        c.setFillColor(ink)
        c.setFont("Helvetica-Bold", 22)
        ty = title_top
        for ln in title_lines:
            c.drawCentredString(cx, ty, ln)
            ty -= 26
        c.setFont("Helvetica", 12)
        c.drawCentredString(cx, ty - 2, f"For {card.recipient_name}")
        ty -= 16
        if note_lines:
            c.setFont("Helvetica-Oblique", 10)
            c.setFillAlpha(0.85)
            for ln in note_lines:
                c.drawCentredString(cx, ty, ln)
                ty -= 13
            c.setFillAlpha(1)
        return ty - 6 * mm  # messages start here on page 1

    # ---- adaptive message layout (<= 2 pages) ----------------------------- #
    def measure(L, msgs):
        ncols = L["ncols"]
        colgap = L["colgap"] * mm
        col_w = (PAGE_W - 2 * M - (ncols - 1) * colgap) / ncols
        text_w = col_w - 2 * L["pad"] * mm
        notes = []
        for m in msgs:
            lines = wrap(m.body, "Helvetica", L["body"], text_w)
            h = (L["pad"] * mm + len(lines) * L["lead"] + 6
                 + L["auth"] + L["pad"] * mm)
            notes.append((m, lines, h))
        return ncols, colgap, col_w, notes

    def simulate(notes, ncols, rowgap, page1_top):
        page = 0
        ys = [page1_top] * ncols
        bottom = M
        for _m, _lines, h in notes:
            placed = False
            for col in sorted(range(ncols), key=lambda i: -ys[i]):
                if ys[col] - h >= bottom:
                    ys[col] -= h + rowgap
                    placed = True
                    break
            if not placed:
                page += 1
                if page > 1:
                    return False
                ys = [PAGE_H - M] * ncols
                ys[0] -= h + rowgap
        return True

    def plan(msgs, page1_top):
        for L in LAYOUTS:
            ncols, colgap, col_w, notes = measure(L, msgs)
            if simulate(notes, ncols, L["rowgap"] * mm, page1_top):
                return L, col_w, colgap, notes
        L = LAYOUTS[-1]
        ncols, colgap, col_w, notes = measure(L, msgs)
        return L, col_w, colgap, notes

    # ---- render ----------------------------------------------------------- #
    paint_bg()
    page1_top = draw_header()
    L, col_w, colgap, notes = plan(msgs, page1_top)
    ncols = L["ncols"]
    col_x = [M + i * (col_w + colgap) for i in range(ncols)]
    rowgap = L["rowgap"] * mm
    pad = L["pad"] * mm

    ys = [page1_top] * ncols
    bottom = M

    def new_page():
        c.showPage()
        paint_bg()
        return [PAGE_H - M] * ncols

    for m, lines, h in notes:
        target = None
        for col in sorted(range(ncols), key=lambda i: -ys[i]):
            if ys[col] - h >= bottom:
                target = col
                break
        if target is None:
            ys = new_page()
            target = 0
        x = col_x[target]
        top = ys[target]
        tilt = max(-5, min(5, getattr(m, "tilt", 0) or 0))
        c.saveState()
        c.translate(x + col_w / 2, top - h / 2)
        c.rotate(tilt)
        c.translate(-(col_w / 2), -(h / 2))
        # drop shadow then the note card
        c.setFillColor(HexColor("#00000022"))
        c.roundRect(1.2, -1.2, col_w, h, 7, stroke=0, fill=1)
        c.setFillColor(HexColor(NOTE_FILL.get(m.color, "#fff3bf")))
        c.roundRect(0, 0, col_w, h, 7, stroke=0, fill=1)
        c.setFillColor(HexColor("#2b2b2b"))
        c.setFont("Helvetica", L["body"])
        ty = h - pad - L["body"]
        for ln in lines:
            c.drawString(pad, ty, ln)
            ty -= L["lead"]
        c.setFont("Helvetica-Bold", L["auth"])
        c.setFillColor(HexColor("#555555"))
        c.drawRightString(col_w - pad, pad - 1, f"\u2014 {m.author_name}")
        c.restoreState()
        ys[target] = top - h - rowgap

    if not msgs:
        c.setFillColor(HexColor("#888888"))
        c.setFont("Helvetica-Oblique", 12)
        c.drawCentredString(PAGE_W / 2, page1_top - 30, "No messages yet.")

    c.save()
    pdf = buf.getvalue()
    resp = HttpResponse(pdf, content_type="application/pdf")
    fname = f"card-{card.recipient_name}-{card.token}.pdf".replace(" ", "_")
    resp["Content-Disposition"] = f'attachment; filename="{fname}"'
    return resp