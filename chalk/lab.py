"""Circuit Lab — the server side.

The lab itself runs in the browser (static/chalk/js/lab/): the circuit
solver, the Arduino interpreter, the bench. The server does four small jobs:

* stores circuits, after checking every field of what arrives;
* answers AI questions through the shared Gemini engine in hanns/ai.py, so
  the key stays in .env and the browser never sees it;
* pins a picture of the bench onto the board's current page, live;
* serves the page, with the board's other circuits listed.

Everything here is owner-only, like the projector view. A lab is the
teacher's workbench; what the class sees is what gets pinned to the board.
"""

import json
import math
import re
import secrets

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.conf import settings
from django.contrib.auth.mixins import LoginRequiredMixin
from django.db import transaction
from django.http import Http404, JsonResponse
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404, render
from django.urls import reverse
from django.views import View

from . import lab_ai, throttle
from .models import (
    IMAGE_TYPES,
    LAB_MODES,
    MAX_ELS_PER_PAGE,
    MAX_IMAGE_BYTES,
    Board,
    BoardCircuit,
    BoardImage,
    BoardPage,
    BoardSession,
    board_image_src,
    clean_src,
)

# A big lesson circuit — an Uno, a full breadboard, a dozen parts and fifty
# wires — is about 25 KB. These limits are an order of magnitude past that.
MAX_PARTS = 300
MAX_WIRES = 800
MAX_BENDS = 40
MAX_CODE = 30_000
MAX_DOC_BYTES = 400_000
MAX_CIRCUITS_PER_BOARD = 60

ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
TYPE_RE = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
REF_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}:[A-Za-z0-9_+#.-]{1,16}$")
PROP_KEY_RE = re.compile(r"^[a-z][a-zA-Z0-9_]{0,23}$")
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
COORD = 50_000

SAVE_LIMIT = 90           # per minute, per user — autosave is debounced to well under this
AI_HOURLY_DEFAULT = 40


class Invalid(ValueError):
    pass


# --------------------------------------------------------------------------
# checking a circuit
# --------------------------------------------------------------------------

def _num(v, lo=-COORD, hi=COORD):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise Invalid("a coordinate is not a number")
    return max(lo, min(hi, round(float(v), 2)))


def _small(value, depth=0, budget=None):
    """A bounded copy of nested JSON, for the block program, which is a tree
    the server has no reason to understand."""
    budget = budget if budget is not None else [4000]
    budget[0] -= 1
    if budget[0] < 0 or depth > 14:
        raise Invalid("the block program is too big")
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value if math.isfinite(value) else 0
    if isinstance(value, str):
        return value[:400]
    if isinstance(value, list):
        return [_small(v, depth + 1, budget) for v in value[:400]]
    if isinstance(value, dict):
        out = {}
        for k, v in list(value.items())[:40]:
            if isinstance(k, str) and len(k) <= 40:
                out[k] = _small(v, depth + 1, budget)
        return out
    raise Invalid("unexpected value in the block program")


def _props(raw):
    out = {}
    if not isinstance(raw, dict):
        return out
    for k, v in list(raw.items())[:24]:
        if not isinstance(k, str) or not PROP_KEY_RE.match(k):
            continue
        if isinstance(v, bool):
            out[k] = v
        elif isinstance(v, (int, float)) and math.isfinite(v):
            out[k] = v
        elif isinstance(v, str) and len(v) <= 40:
            out[k] = v
    return out


def _end(raw):
    if not isinstance(raw, dict):
        raise Invalid("a wire end is missing")
    out = {}
    ref = raw.get("ref")
    if isinstance(ref, str) and REF_RE.match(ref):
        out["ref"] = ref
    if "x" in raw and "y" in raw:
        out["x"] = _num(raw["x"])
        out["y"] = _num(raw["y"])
    if not out:
        raise Invalid("a wire end has neither a pin nor a position")
    return out


def clean_circuit(data):
    """Whitelist a circuit document. Raises Invalid with a reason.

    The browser validates too, but the browser is not the only thing that
    can send a POST. Unknown part types are allowed through by shape (a part
    added to the drawer later should not need this file edited), the same
    decision the board makes for figure kinds.
    """
    if not isinstance(data, dict):
        raise Invalid("the circuit is not an object")
    parts_in = data.get("parts") or []
    wires_in = data.get("wires") or []
    if not isinstance(parts_in, list) or not isinstance(wires_in, list):
        raise Invalid("parts and wires must be lists")
    if len(parts_in) > MAX_PARTS:
        raise Invalid(f"too many parts (the limit is {MAX_PARTS})")
    if len(wires_in) > MAX_WIRES:
        raise Invalid(f"too many wires (the limit is {MAX_WIRES})")

    parts, seen = [], set()
    for p in parts_in:
        if not isinstance(p, dict):
            raise Invalid("a part is not an object")
        pid, ptype = str(p.get("id") or ""), str(p.get("type") or "")
        if not ID_RE.match(pid) or not TYPE_RE.match(ptype) or pid in seen:
            raise Invalid("a part has a bad id or type")
        seen.add(pid)
        rot = p.get("rot") or 0
        parts.append({
            "id": pid, "type": ptype,
            "x": _num(p.get("x", 0)), "y": _num(p.get("y", 0)),
            "rot": int(rot) % 4 if isinstance(rot, int) and not isinstance(rot, bool) else 0,
            "flip": bool(p.get("flip")),
            "props": _props(p.get("props")),
        })

    wires, wseen = [], set()
    for w in wires_in:
        if not isinstance(w, dict):
            raise Invalid("a wire is not an object")
        wid = str(w.get("id") or "")
        if not ID_RE.match(wid) or wid in wseen:
            raise Invalid("a wire has a bad id")
        wseen.add(wid)
        pts = []
        for q in (w.get("pts") or [])[:MAX_BENDS]:
            if isinstance(q, list) and len(q) == 2:
                pts.append([_num(q[0]), _num(q[1])])
        color = w.get("color") if isinstance(w.get("color"), str) and COLOR_RE.match(w.get("color")) else "#e8c22a"
        wires.append({"id": wid, "a": _end(w.get("a")), "b": _end(w.get("b")), "color": color, "pts": pts})

    code = data.get("code") or ""
    if not isinstance(code, str):
        raise Invalid("the program is not text")
    if len(code) > MAX_CODE:
        raise Invalid("the program is too long")

    view = data.get("view") if isinstance(data.get("view"), dict) else {}
    out = {
        "v": 1,
        "mode": "kid" if data.get("mode") == "kid" else "pro",
        "parts": parts,
        "wires": wires,
        "code": code,
        "prog": "blocks" if data.get("prog") == "blocks" else "code",
        "blocks": _small(data.get("blocks")) if data.get("blocks") is not None else None,
        "view": {
            "x": _num(view.get("x", 0)) if isinstance(view.get("x"), (int, float)) else 0,
            "y": _num(view.get("y", 0)) if isinstance(view.get("y"), (int, float)) else 0,
            "z": _num(view.get("z", 1), 0, 6) if isinstance(view.get("z"), (int, float)) else 1,
        },
    }
    if len(json.dumps(out)) > MAX_DOC_BYTES:
        raise Invalid("the circuit is too big to save")
    return out


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

def _owned_board(request, pk):
    return get_object_or_404(Board, pk=pk, owner=request.user)


def _json_body(request):
    """JSON from a fetch, or a `payload` form field from sendBeacon — which
    is what fires when the tab closes and cannot set a JSON content type."""
    if request.content_type == "application/json":
        try:
            return json.loads(request.body.decode("utf-8") or "{}")
        except (ValueError, UnicodeDecodeError):
            raise Invalid("that wasn't valid JSON")
    raw = request.POST.get("payload")
    if raw:
        try:
            return json.loads(raw)
        except ValueError:
            raise Invalid("that wasn't valid JSON")
    raise Invalid("nothing was sent")


def _err(msg, status=400):
    return JsonResponse({"ok": False, "error": msg}, status=status)


def _ai_enabled():
    try:
        from hanns import ai as hai
        return hai.is_enabled()
    except Exception:
        return False


# --------------------------------------------------------------------------
# views
# --------------------------------------------------------------------------

class LabView(LoginRequiredMixin, View):
    """The lab page. With no circuit id it opens the board's most recent
    circuit, or a fresh one that is created on its first save."""

    template_name = "chalk/lab.html"

    def get(self, request, pk, cid=None):
        board = _owned_board(request, pk)
        circuits = list(board.circuits.only("id", "title", "mode", "updated_at", "board_id"))
        if cid:
            circuit = next((c for c in circuits if c.id == cid), None)
            if circuit is None:
                raise Http404
            circuit = BoardCircuit.objects.get(pk=circuit.pk)
        elif request.GET.get("new") or request.GET.get("example"):
            circuit = None
        else:
            circuit = BoardCircuit.objects.filter(board=board).first()

        mode = request.GET.get("mode")
        if mode not in dict(LAB_MODES):
            mode = circuit.mode if circuit else None
        example = request.GET.get("example") or ""
        zero = "00000000-0000-0000-0000-000000000000"
        config = {
            "boardId": str(board.id),
            "boardTitle": board.title,
            "circuitId": str(circuit.id) if circuit else None,
            "title": circuit.title if circuit else "Untitled circuit",
            "data": circuit.data if circuit and circuit.data else None,
            "mode": mode,
            "example": example if re.match(r"^[a-z0-9_]{1,24}$", example) else "",
            "saveUrl": reverse("chalk:lab_save", args=[board.id]),
            "aiUrl": reverse("chalk:lab_ai", args=[board.id]),
            "aiEnabled": _ai_enabled(),
            "pinUrl": reverse("chalk:lab_pin", args=[board.id]),
            "openUrl": reverse("chalk:lab_open", args=[board.id, zero]),
            "newUrl": reverse("chalk:lab", args=[board.id]) + "?new=1",
            "stageUrl": reverse("chalk:stage", args=[board.id]),
            "csrf": get_token(request),
        }
        return render(request, self.template_name, {
            "board": board,
            "circuit": circuit,
            "circuits": circuits,
            "config": config,
        })


class LabSaveView(LoginRequiredMixin, View):
    def post(self, request, pk):
        board = _owned_board(request, pk)
        if not throttle.hit("lab-save", request.user.id, SAVE_LIMIT, 60):
            return _err("Saving too often. Wait a moment.", 429)
        try:
            body = _json_body(request)
            if not isinstance(body, dict):
                raise Invalid("nothing was sent")
            data = clean_circuit(body.get("data"))
        except Invalid as e:
            return _err(f"Couldn't save: {e}.")
        title = str(body.get("title") or "").strip()[:200] or "Untitled circuit"

        cid = body.get("id")
        if cid:
            circuit = BoardCircuit.objects.filter(pk=cid, board=board).first() if _is_uuid(cid) else None
            if circuit is None:
                return _err("That circuit no longer exists.", 404)
        else:
            if board.circuits.count() >= MAX_CIRCUITS_PER_BOARD:
                return _err("This board already has the most circuits it can hold. Delete one first.", 409)
            circuit = BoardCircuit(board=board)
        circuit.title = title
        circuit.mode = data["mode"]
        circuit.data = data
        circuit.save()
        board.touch()
        return JsonResponse({
            "ok": True,
            "id": str(circuit.id),
            "url": reverse("chalk:lab_open", args=[board.id, circuit.id]),
        })


def _is_uuid(v):
    import uuid
    try:
        uuid.UUID(str(v))
        return True
    except ValueError:
        return False


class LabDeleteView(LoginRequiredMixin, View):
    def post(self, request, pk, cid):
        board = _owned_board(request, pk)
        deleted, _ = BoardCircuit.objects.filter(pk=cid, board=board).delete()
        if not deleted:
            return _err("That circuit no longer exists.", 404)
        return JsonResponse({"ok": True, "next": reverse("chalk:lab", args=[board.id])})


class LabAIView(LoginRequiredMixin, View):
    """Explain, diagnose, write code, or design a circuit.

    The browser sends the netlist and the simulator's readings; the answer
    comes back as JSON, is cleaned here against the part catalogue, and is
    checked again in the browser before anything is built from it.
    """

    def post(self, request, pk):
        board = _owned_board(request, pk)
        if not _ai_enabled():
            return _err("AI isn't switched on for this server. Add GEMINI_API_KEY to the .env file.", 503)
        limit = int(getattr(settings, "CHALK_LAB_AI_HOURLY_LIMIT", AI_HOURLY_DEFAULT) or AI_HOURLY_DEFAULT)
        if not throttle.hit("lab-ai", request.user.id, limit, 3600):
            return _err(f"That's the {limit} AI questions for this hour. They refill on the hour.", 429)
        if len(request.body or b"") > 120_000:
            return _err("That circuit is too big to send to the AI.", 413)
        try:
            body = _json_body(request)
        except Invalid as e:
            return _err(str(e))
        try:
            answer = lab_ai.ask(body)
        except lab_ai.AIUnavailable as e:
            return _err(str(e), getattr(e, "status", 502))
        return JsonResponse({"ok": True, **answer})


class LabPinView(LoginRequiredMixin, View):
    """Put a picture of the bench on the board's current page.

    It arrives on the projector straight away, as one undoable step, exactly
    as if the teacher had added a photo from their phone.
    """

    def post(self, request, pk):
        board = _owned_board(request, pk)
        if not throttle.hit("lab-pin", request.user.id, 12, 60):
            return _err("Pinning too fast. Wait a moment.", 429)
        upload = request.FILES.get("file")
        if not upload:
            return _err("No picture arrived.")
        if upload.size > MAX_IMAGE_BYTES or upload.content_type not in IMAGE_TYPES:
            return _err("That picture couldn't be used.")
        try:
            from PIL import Image

            probe = Image.open(upload)
            probe.verify()
            width, height = probe.size
            upload.seek(0)
        except Exception:
            return _err("That picture couldn't be read.")
        if not width or not height:
            return _err("That picture couldn't be read.")

        image = BoardImage.objects.create(board=board, file=upload, width=width, height=height)
        src = board_image_src(image)
        if not clean_src(src):
            image.delete()
            return _err("This server couldn't work out an address for the picture.", 500)

        # Half the board wide, centred, never taller than the board. The
        # page is 16:9, so a normalised height is the width times the
        # picture's ratio times 16/9.
        w = 0.5
        h = w * (height / width) * (16 / 9)
        if h > 0.9:
            w, h = w * 0.9 / h, 0.9
        el = {
            "id": "e_lab" + secrets.token_hex(5),
            "type": "image",
            "src": src,
            "x": round(0.5 - w / 2, 4), "y": round(0.5 - h / 2, 4),
            "w": round(w, 4), "h": round(h, 4), "rot": 0,
            "by": str(request.user.id),
        }

        from .consumers import ChalkConsumer

        session = board.ensure_session()
        with transaction.atomic():
            sess = BoardSession.objects.select_for_update().get(pk=session.pk)
            page = BoardPage.objects.select_for_update().filter(board=board, index=sess.page_index).first()
            if page is None:
                page = board.ensure_page(sess.page_index)
                page = BoardPage.objects.select_for_update().get(pk=page.pk)
            els = list(page.els or [])
            if len(els) >= MAX_ELS_PER_PAGE:
                image.delete()
                return _err("That page is full. Turn to a new page on the board and try again.", 409)
            els.append(el)
            history = list(page.history or [])
            history.append({"op": "add", "layer": "els", "items": [{"i": len(els) - 1, "s": el}]})
            page.history, page.undone = ChalkConsumer._trim_history(history, [])
            page.els = els
            page.save(update_fields=["els", "history", "undone", "updated_at"])
        board.touch()

        layer = get_channel_layer()
        if layer is not None:
            try:
                async_to_sync(layer.group_send)(f"chalk_{sess.code}", {
                    "type": "fan.out",
                    "payload": {"t": "el_add", "el": el, "by": str(request.user.id),
                                "canUndo": True, "canRedo": False},
                    "origin": "",
                })
            except Exception:
                # The picture is saved on the page either way; a projector
                # that missed the frame picks it up on its next snapshot.
                pass
        return JsonResponse({"ok": True, "page": sess.page_index, "id": el["id"]})
