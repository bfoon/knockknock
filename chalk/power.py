"""Power Lab — the server side.

The lab runs in the browser (static/chalk/js/power/): the solver, the sun,
the sizing and the drawing. The server stores plans after checking every
field of what arrives, answers AI questions through the shared engine so
the key stays in .env, and serves the page. Pinning a picture of a plan
to the board reuses the Circuit Lab's endpoint: a picture is a picture.

Owner-only, like the Circuit Lab and the projector.
"""

import json
import math
import re

from django.conf import settings
from django.contrib.auth.mixins import LoginRequiredMixin
from django.http import Http404, JsonResponse
from django.middleware.csrf import get_token
from django.shortcuts import render
from django.urls import reverse
from django.views import View

from . import power_ai, throttle
from .lab import Invalid, _ai_enabled, _err, _is_uuid, _json_body, _owned_board, _text
from .models import BoardPlan

MAX_PARTS = 400
MAX_WIRES = 1200
MAX_DOC_BYTES = 500_000
MAX_PLANS_PER_BOARD = 60
SAVE_LIMIT = 90
AI_HOURLY_DEFAULT = 40

ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
TYPE_RE = re.compile(r"^[a-z][a-z0-9_]{0,23}$")
# "partId:terminal" — terminals are names like L, PV+, S1-, 3
END_RE = re.compile(r"^([A-Za-z0-9_-]{1,40}):([A-Za-z0-9+\-]{1,6})$")
KEY_RE = re.compile(r"^[a-z][a-zA-Z0-9_]{0,23}$")
PRICE_KEY_RE = re.compile(r"^[a-z0-9_]{1,24}(\|[^<>\x00-\x1f]{0,80})?$")
SIZES = {0.75, 1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95}


def _num(v, lo, hi, default):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        return default
    return max(lo, min(hi, round(float(v), 3)))


def _props(raw):
    out = {}
    if not isinstance(raw, dict):
        return out
    for k, v in list(raw.items())[:20]:
        if not isinstance(k, str) or not KEY_RE.match(k):
            continue
        if isinstance(v, bool):
            out[k] = v
        elif isinstance(v, (int, float)) and math.isfinite(v):
            out[k] = max(-1e6, min(1e6, v))
        elif isinstance(v, str):
            out[k] = _text(v, 60)
    return out


def clean_plan(data):
    """Whitelist a plan document. Raises Invalid with a reason.

    Part types are allowed through by shape, as in the Circuit Lab: a part
    added to the catalogue later should not need this file edited. The
    browser drops any type it does not know when it opens the plan.
    """
    if not isinstance(data, dict):
        raise Invalid("the plan is not an object")
    parts_in, wires_in = data.get("parts") or [], data.get("wires") or []
    if not isinstance(parts_in, list) or not isinstance(wires_in, list):
        raise Invalid("parts and cables must be lists")
    if len(parts_in) > MAX_PARTS:
        raise Invalid(f"too many parts (the limit is {MAX_PARTS})")
    if len(wires_in) > MAX_WIRES:
        raise Invalid(f"too many cables (the limit is {MAX_WIRES})")

    parts, seen = [], set()
    for p in parts_in:
        if not isinstance(p, dict):
            raise Invalid("a part is not an object")
        pid, ptype = str(p.get("id") or ""), str(p.get("type") or "")
        if not ID_RE.match(pid) or not TYPE_RE.match(ptype) or pid in seen:
            raise Invalid("a part has a bad id or type")
        seen.add(pid)
        item = {"id": pid, "type": ptype, "x": _num(p.get("x"), -50000, 50000, 0), "y": _num(p.get("y"), -50000, 50000, 0),
                "props": _props(p.get("props"))}
        name = _text(p.get("name"))
        if name:
            item["name"] = name
        parts.append(item)

    wires, wseen = [], set()
    for w in wires_in:
        if not isinstance(w, dict):
            raise Invalid("a cable is not an object")
        wid = str(w.get("id") or "")
        a, b = END_RE.match(str(w.get("a") or "")), END_RE.match(str(w.get("b") or ""))
        if not ID_RE.match(wid) or wid in wseen or not a or not b:
            raise Invalid("a cable has a bad id or end")
        if a.group(1) not in seen or b.group(1) not in seen:
            continue      # its part is gone: drop the cable rather than refuse the save
        wseen.add(wid)
        mm2 = w.get("mm2")
        wires.append({"id": wid, "a": a.group(0), "b": b.group(0),
                      "mm2": mm2 if isinstance(mm2, (int, float)) and not isinstance(mm2, bool) and mm2 in SIZES else 2.5,
                      "len": _num(w.get("len"), 0.1, 500, 2)})

    site_in = data.get("site") if isinstance(data.get("site"), dict) else {}
    site = {
        "name": _text(site_in.get("name")) or "Banjul",
        "lat": _num(site_in.get("lat"), -60, 65, 13.45), "tilt": _num(site_in.get("tilt"), 0, 90, 15),
        "az": _num(site_in.get("az"), 0, 360, 180), "month": int(_num(site_in.get("month"), 1, 12, 3)),
        "cloud": _num(site_in.get("cloud"), -1, 1, -1), "dust": _num(site_in.get("dust"), 0, 80, 0),
        "tamb": _num(site_in.get("tamb"), -1, 55, -1),
    }
    prices = {}
    for k, v in list((data.get("prices") or {}).items())[:200] if isinstance(data.get("prices"), dict) else []:
        if isinstance(k, str) and PRICE_KEY_RE.match(k) and isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v):
            prices[k] = max(0, min(1e8, round(float(v), 2)))
    view = data.get("view") if isinstance(data.get("view"), dict) else {}
    out = {
        "v": 1, "parts": parts, "wires": wires, "site": site, "prices": prices,
        "clock": _num(data.get("clock"), 0, 24, 12), "tariff": _num(data.get("tariff"), 0, 200, 13.5),
        "view": {"x": _num(view.get("x"), -1e5, 1e5, 0), "y": _num(view.get("y"), -1e5, 1e5, 0), "z": _num(view.get("z"), 0.1, 4, 1)},
    }
    # a fault hidden for a class to find: which part, which setting, what it was
    secret = data.get("secret")
    if isinstance(secret, dict) and secret.get("id") in seen and isinstance(secret.get("k"), str) and KEY_RE.match(secret["k"]):
        was = secret.get("was")
        out["secret"] = {"id": secret["id"], "k": secret["k"], "say": _text(secret.get("say"), 160),
                         "was": was if isinstance(was, (bool, int, float)) else _text(was, 40)}
    if len(json.dumps(out)) > MAX_DOC_BYTES:
        raise Invalid("the plan is too big to save")
    return out


class PowerView(LoginRequiredMixin, View):
    """The lab page. With no plan id it opens the board's most recent plan,
    or a fresh one that is created on its first save."""

    template_name = "chalk/power.html"

    def get(self, request, pk, plan_id=None):
        board = _owned_board(request, pk)
        plans = list(board.plans.only("id", "title", "updated_at", "board_id"))
        if plan_id:
            plan = BoardPlan.objects.filter(pk=plan_id, board=board).first()
            if plan is None:
                raise Http404
        elif request.GET.get("new"):
            plan = None
        else:
            plan = BoardPlan.objects.filter(board=board).first()
        zero = "00000000-0000-0000-0000-000000000000"
        config = {
            "boardId": str(board.id),
            "boardTitle": board.title,
            "planId": str(plan.id) if plan else None,
            "title": plan.title if plan else "Untitled plan",
            "data": plan.data if plan and plan.data else None,
            "saveUrl": reverse("chalk:power_save", args=[board.id]),
            "aiUrl": reverse("chalk:power_ai", args=[board.id]),
            "aiEnabled": _ai_enabled(),
            "pinUrl": reverse("chalk:lab_pin", args=[board.id]),
            "openUrl": reverse("chalk:power_open", args=[board.id, zero]),
            "newUrl": reverse("chalk:power", args=[board.id]) + "?new=1",
            "stageUrl": reverse("chalk:stage", args=[board.id]),
            "csrf": get_token(request),
        }
        return render(request, self.template_name, {"board": board, "plan": plan, "plans": plans, "config": config})


class PowerSaveView(LoginRequiredMixin, View):
    def post(self, request, pk):
        board = _owned_board(request, pk)
        if not throttle.hit("power-save", request.user.id, SAVE_LIMIT, 60):
            return _err("Saving too often. Wait a moment.", 429)
        try:
            body = _json_body(request)
            if not isinstance(body, dict):
                raise Invalid("nothing was sent")
            data = clean_plan(body.get("data"))
        except Invalid as e:
            return _err(f"Couldn't save: {e}.")
        title = str(body.get("title") or "").strip()[:200] or "Untitled plan"
        plan_id = body.get("id")
        if plan_id:
            plan = BoardPlan.objects.filter(pk=plan_id, board=board).first() if _is_uuid(plan_id) else None
            if plan is None:
                return _err("That plan no longer exists.", 404)
        else:
            if board.plans.count() >= MAX_PLANS_PER_BOARD:
                return _err("This board already has the most plans it can hold. Delete one first.", 409)
            plan = BoardPlan(board=board)
        plan.title = title
        plan.data = data
        plan.save()
        board.touch()
        return JsonResponse({"ok": True, "id": str(plan.id), "url": reverse("chalk:power_open", args=[board.id, plan.id])})


class PowerDeleteView(LoginRequiredMixin, View):
    def post(self, request, pk, plan_id):
        board = _owned_board(request, pk)
        deleted, _ = BoardPlan.objects.filter(pk=plan_id, board=board).delete()
        if not deleted:
            return _err("That plan no longer exists.", 404)
        return JsonResponse({"ok": True, "next": reverse("chalk:power", args=[board.id])})


class PowerAIView(LoginRequiredMixin, View):
    """Explain, diagnose, size, or turn words into a design spec.

    Shares the Circuit Lab's hourly allowance: one teacher, one budget.
    """

    def post(self, request, pk):
        _owned_board(request, pk)
        if not _ai_enabled():
            return _err("AI isn't switched on for this server. Add GEMINI_API_KEY to the .env file.", 503)
        limit = int(getattr(settings, "CHALK_LAB_AI_HOURLY_LIMIT", AI_HOURLY_DEFAULT) or AI_HOURLY_DEFAULT)
        if not throttle.hit("lab-ai", request.user.id, limit, 3600):
            return _err(f"That's the {limit} AI questions for this hour. They refill on the hour.", 429)
        if len(request.body or b"") > 140_000:
            return _err("That plan is too big to send to the AI.", 413)
        try:
            body = _json_body(request)
        except Invalid as e:
            return _err(str(e))
        try:
            answer = power_ai.ask(body)
        except power_ai.AIUnavailable as e:
            return _err(str(e), getattr(e, "status", 502))
        return JsonResponse({"ok": True, **answer})
