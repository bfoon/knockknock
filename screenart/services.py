"""Image processing + the `backdrop` part of the Big Screen state snapshot."""

import io
import re
import uuid

from django.core.files.base import ContentFile
from django.core.files.storage import default_storage

from .models import DEFAULT_STYLE, MAX_IMAGES_PER_SCREEN, ScreenBackdrop, ScreenStyle

MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_PIXELS = 60_000_000
LONG_EDGE = 3840                  # 4K projectors; bigger only costs bandwidth
FORMATS = {"JPEG", "PNG", "WEBP", "GIF"}
HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
SLIDESHOW = (0, 8, 15, 30, 60)


class BackdropError(ValueError):
    pass


def process_upload(upload):
    """Validate an uploaded image and return (ContentFile, ext, w, h).

    Still images are re-encoded: that strips EXIF (including GPS location),
    applies the camera's rotation, and shrinks anything larger than 4K.
    Animated GIF / WebP are kept as they are (re-encoding would break them).
    """
    from PIL import Image, ImageOps, UnidentifiedImageError

    if upload.size > MAX_UPLOAD_BYTES:
        raise BackdropError("That image is bigger than 25 MB — try a smaller export.")
    raw = upload.read()
    try:
        probe = Image.open(io.BytesIO(raw))
        probe.verify()
        img = Image.open(io.BytesIO(raw))
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError):
        raise BackdropError("That file isn't an image we can show (use JPG, PNG, WebP or GIF).")
    if img.format not in FORMATS:
        raise BackdropError("Use a JPG, PNG, WebP or GIF image.")
    w, h = img.size
    if w * h > MAX_PIXELS:
        raise BackdropError("That image has too many pixels — export it at 4K or smaller.")
    if getattr(img, "is_animated", False):
        ext = "gif" if img.format == "GIF" else "webp"
        return ContentFile(raw), ext, w, h
    img = ImageOps.exif_transpose(img)
    if max(img.size) > LONG_EDGE:
        img.thumbnail((LONG_EDGE, LONG_EDGE), Image.LANCZOS)
    has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
    out = io.BytesIO()
    if has_alpha:
        img.convert("RGBA").save(out, "PNG", optimize=True)
        ext = "png"
    else:
        img.convert("RGB").save(out, "JPEG", quality=90, progressive=True, optimize=True)
        ext = "jpg"
    return ContentFile(out.getvalue()), ext, img.size[0], img.size[1]


def add_image(screen_id, upload):
    if ScreenBackdrop.objects.filter(screen_id=screen_id).count() >= MAX_IMAGES_PER_SCREEN:
        raise BackdropError(f"A screen can hold {MAX_IMAGES_PER_SCREEN} backgrounds — delete one first.")
    content, ext, w, h = process_upload(upload)
    path = default_storage.save(f"hanns/screens/{screen_id}/{uuid.uuid4().hex}.{ext}", content)
    last = ScreenBackdrop.objects.filter(screen_id=screen_id).order_by("-position").first()
    b = ScreenBackdrop.objects.create(screen_id=screen_id, image=path, width=w, height=h,
                                      name=str(getattr(upload, "name", "") or "")[:120],
                                      position=(last.position + 1) if last else 0)
    style = style_for(screen_id)
    if not style.settings.get("active"):
        style.settings = dict(style.settings, active=str(b.id))
        style.save(update_fields=["settings", "updated_at"])
    return b


def delete_image(screen_id, image_id):
    b = ScreenBackdrop.objects.filter(screen_id=screen_id, pk=image_id).first()
    if not b:
        return False
    try:
        default_storage.delete(b.image.name)
    except Exception:
        pass
    b.delete()
    style = style_for(screen_id)
    if style.settings.get("active") == str(image_id):
        nxt = ScreenBackdrop.objects.filter(screen_id=screen_id).first()
        settings = dict(style.settings, active=str(nxt.id) if nxt else None)
        if not nxt:
            settings["show"] = False          # nothing left to show
        style.settings = settings
        style.save(update_fields=["settings", "updated_at"])
    return True


def delete_all(screen_id):
    for b in ScreenBackdrop.objects.filter(screen_id=screen_id):
        try:
            default_storage.delete(b.image.name)
        except Exception:
            pass
    ScreenBackdrop.objects.filter(screen_id=screen_id).delete()
    ScreenStyle.objects.filter(screen_id=screen_id).delete()


def style_for(screen_id):
    style, _ = ScreenStyle.objects.get_or_create(screen_id=screen_id, defaults={"settings": {}})
    return style


def clean_settings(screen_id, data):
    """Validate a settings patch; unknown keys and bad values are ignored."""
    out = {}
    if not isinstance(data, dict):
        return out
    if "active" in data:
        a = data.get("active")
        if a is None or ScreenBackdrop.objects.filter(screen_id=screen_id, pk=str(a)).exists():
            out["active"] = str(a) if a else None
    for k in ("show", "lobby", "code"):
        if k in data:
            out[k] = bool(data[k])
    if data.get("fit") in ("cover", "contain"):
        out["fit"] = data["fit"]
    if data.get("motion") in ("still", "drift"):
        out["motion"] = data["motion"]
    if "dim" in data:
        try:
            out["dim"] = max(0, min(80, int(data["dim"])))
        except (TypeError, ValueError):
            pass
    if "slideshow" in data:
        try:
            s = int(data["slideshow"])
            if s in SLIDESHOW:
                out["slideshow"] = s
        except (TypeError, ValueError):
            pass
    if "caption" in data:
        out["caption"] = " ".join(str(data.get("caption") or "").split())[:140]
    if "countdown" in data:
        c = str(data.get("countdown") or "").strip()
        if c == "" or HHMM.match(c):
            out["countdown"] = c
    return out


def update_settings(screen_id, data):
    style = style_for(screen_id)
    patch = clean_settings(screen_id, data)
    if patch.get("show") and not ScreenBackdrop.objects.filter(screen_id=screen_id).exists():
        raise BackdropError("Upload an event background first.")
    style.settings = dict(style.settings or {}, **patch)
    style.save(update_fields=["settings", "updated_at"])
    return style


def state_for(screen_id):
    """The `backdrop` entry of the Big Screen snapshot."""
    images = [{"id": str(b.id), "url": b.image.url, "w": b.width, "h": b.height, "name": b.name}
              for b in ScreenBackdrop.objects.filter(screen_id=screen_id)]
    style = ScreenStyle.objects.filter(screen_id=screen_id).first()
    settings = style.merged() if style else dict(DEFAULT_STYLE)
    ids = {i["id"] for i in images}
    if settings.get("active") not in ids:
        settings["active"] = images[0]["id"] if images else None
    if not images:
        settings["show"] = False
    return dict(settings, images=images)
