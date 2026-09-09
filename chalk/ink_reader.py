"""Chalk — reading handwriting off the board.

Shapes can be recognised on the phone: a circle is a circle by arithmetic, and
chalk_recognise.js does it offline in a millisecond. Words cannot. Turning a
handwritten word into typed text needs a model that has seen handwriting, and
there is no such thing built into a browser.

So this is the one part of the board that reaches outside it, and it is built
to be switched off. If no reader is configured the endpoint says so plainly,
the phone hides the "Typed words" option, and every other kind of recognition
carries on working with no network at all. A board on a school network that
blocks the internet loses this feature and nothing else.

Configuring one::

    CHALK_INK_READER = "chalk.ink_reader.anthropic"
    CHALK_INK_READER_KEY = os.environ["ANTHROPIC_API_KEY"]
    CHALK_INK_READER_MODEL = "claude-sonnet-4-6"     # optional

`CHALK_INK_READER` is a dotted path to any callable taking the PNG bytes and
returning a string, so a school running its own OCR service points it at that
instead and nothing else here changes.

What is sent: a black-on-white PNG of the strokes that were picked, and
nothing else. No board title, no page, no account, no other handwriting on
the page. It is rendered on the phone from the points, so what leaves the
building is a picture of a word.
"""

import base64
import json
import logging

from django.conf import settings
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.utils.module_loading import import_string
from django.views import View

from . import throttle
from .models import Board

log = logging.getLogger(__name__)

# A word, a line, or a short paragraph. Anything past this is a photograph of
# a page, which is not what this is for.
MAX_PNG_BYTES = 900 * 1024
MAX_TEXT = 400

READ_LIMIT, READ_WINDOW = 20, 60
READ_HOUR_LIMIT, READ_HOUR_WINDOW = 160, 3600

PROMPT = (
    "This is handwriting from a classroom board, drawn on a phone with a "
    "finger, so the letters are rough. Transcribe exactly what is written and "
    "nothing else. Keep the line breaks. If it is a number or an equation, "
    "write it as digits and symbols. If you cannot read it, reply with the "
    "single word UNREADABLE."
)


def is_configured():
    return bool(getattr(settings, "CHALK_INK_READER", ""))


def read_png(png_bytes):
    """Hand the picture to whatever reader is configured. Returns "" if none
    is, or if it could not make anything of it."""
    path = getattr(settings, "CHALK_INK_READER", "")
    if not path:
        return ""
    try:
        reader = import_string(path)
    except ImportError:
        log.warning("CHALK_INK_READER points at %r, which does not import", path)
        return ""
    try:
        text = reader(png_bytes) or ""
    except Exception:
        # A reader that is down, rate-limited or misconfigured must not take
        # the board with it. The teacher gets "could not read that", taps
        # Cancel, and the lesson carries on.
        log.exception("ink reader failed")
        return ""
    text = str(text).strip()
    if text.upper() == "UNREADABLE":
        return ""
    return text[:MAX_TEXT]


def anthropic(png_bytes):
    """The default reader. Needs `httpx` or `requests`, and a key in
    CHALK_INK_READER_KEY."""
    key = getattr(settings, "CHALK_INK_READER_KEY", "")
    if not key:
        raise RuntimeError("CHALK_INK_READER_KEY is not set")
    model = getattr(settings, "CHALK_INK_READER_MODEL", "claude-sonnet-4-6")

    body = {
        "model": model,
        "max_tokens": 300,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": base64.b64encode(png_bytes).decode("ascii"),
                        },
                    },
                    {"type": "text", "text": PROMPT},
                ],
            }
        ],
    }

    import urllib.request

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "content-type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    parts = [b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"]
    return "\n".join(p for p in parts if p)


class ReadInkView(View):
    """POST a PNG of some picked handwriting, get back the words.

    Paired like the photo upload: the phone driving the board is usually not
    signed in, so the pairing is the credential.
    """

    def post(self, request, pk):
        # Imported here rather than at module scope so this file can be added
        # without touching the import graph in views.py.
        from .views import paired

        board = get_object_or_404(Board, pk=pk)
        session = board.ensure_session()
        if not session.is_live or not paired(request, board, session):
            return JsonResponse(
                {"ok": False, "error": "This phone is not paired with the board."},
                status=403,
            )

        if not is_configured():
            # Not an error. The board simply cannot do this, and the phone
            # needs to know so it can stop offering it.
            return JsonResponse({"ok": False, "reason": "off"}, status=200)

        ip = throttle.client_ip(request)
        if not (
            throttle.hit("read", ip, READ_LIMIT, READ_WINDOW)
            and throttle.hit("read-hr", ip, READ_HOUR_LIMIT, READ_HOUR_WINDOW)
        ):
            return JsonResponse(
                {"ok": False, "error": "Too many at once. Wait a moment."},
                status=429,
            )

        try:
            payload = json.loads(request.body.decode("utf-8") or "{}")
        except (ValueError, UnicodeDecodeError):
            return JsonResponse({"ok": False, "error": "Bad request."}, status=400)

        raw = str(payload.get("png") or "")
        prefix = "data:image/png;base64,"
        if not raw.startswith(prefix):
            return JsonResponse({"ok": False, "error": "Bad request."}, status=400)
        try:
            png = base64.b64decode(raw[len(prefix):], validate=True)
        except Exception:
            return JsonResponse({"ok": False, "error": "Bad request."}, status=400)

        if not png.startswith(b"\x89PNG\r\n\x1a\n"):
            return JsonResponse({"ok": False, "error": "Bad request."}, status=400)
        if len(png) > MAX_PNG_BYTES:
            return JsonResponse({"ok": False, "error": "That is too big."}, status=400)

        text = read_png(png)
        if not text:
            return JsonResponse({"ok": False, "reason": "unreadable"}, status=200)
        return JsonResponse({"ok": True, "text": text})
