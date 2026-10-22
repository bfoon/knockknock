"""
kura/livetrace.py — live GPS traces streamed from Kura Collect phones.

While an enumerator records a route or walks an area in the app's map
question, the phone streams its GPS points here every few seconds (or
buffers them offline and flushes on reconnect). Supervisors watch the
trace grow in real time on the survey's live map.

Live traces are a *monitoring* aid, kept in the cache for TRACE_TTL. The
authoritative data is still the submission the phone syncs when the form
is finished — so no database table (and no migration) is needed.

Idempotent by design: every batch carries a per-session sequence number.
A phone that lost its connection mid-request simply re-sends; batches at or
below the last accepted seq are acknowledged without being stored twice.
"""

from __future__ import annotations

import time

from django.core.cache import cache

from .geo import _pos, path_length_m, ring_area_m2

TRACE_TTL = 12 * 3600          # seconds a trace stays visible after its last update
MAX_POINTS = 20000             # per session
MAX_BATCH = 500                # points per request
KINDS = {"track", "area"}
STATUSES = {"recording", "paused", "finished", "discarded"}


def _key(code, session):
    return f"kura:live:{code.upper()}:{session}"


def _index_key(code):
    return f"kura:live:{code.upper()}:index"


def _clean_session(value):
    s = "".join(ch for ch in str(value or "") if ch.isalnum() or ch in "-_")[:64]
    return s or None


def ingest(code, device, data):
    """Store one batch. Returns (response_dict, broadcast_payload_or_None)."""
    session = _clean_session(data.get("session"))
    if not session:
        return {"ok": False, "error": "Missing session id."}, None
    try:
        seq = int(data.get("seq"))
    except (TypeError, ValueError):
        return {"ok": False, "error": "Missing batch sequence number."}, None

    key = _key(code, session)
    trace = cache.get(key) or {
        "session": session,
        "device": getattr(device, "name", "") or "",
        "enumerator": device.user.get_username() if getattr(device, "user", None) else "",
        "question": str(data.get("question") or "")[:80],
        "label": str(data.get("label") or "")[:80],
        "kind": data.get("kind") if data.get("kind") in KINDS else "track",
        "color": str(data.get("color") or "#22d3ee")[:9],
        "started": time.time(),
        "last_seq": -1,
        "points": [],
        "status": "recording",
    }

    status = data.get("status") if data.get("status") in STATUSES else trace["status"]
    if seq <= trace["last_seq"]:
        # Already have this batch (a retry after a lost response).
        return {"ok": True, "accepted": 0, "last_seq": trace["last_seq"], "duplicate": True}, None

    new = []
    room = MAX_POINTS - len(trace["points"])
    for raw in (data.get("points") or [])[:MAX_BATCH]:
        p = _pos(raw)
        if p and room > 0:
            new.append(p)
            room -= 1
    trace["points"].extend(new)
    trace["last_seq"] = seq
    trace["status"] = status
    trace["updated"] = time.time()
    if data.get("label"):
        trace["label"] = str(data["label"])[:80]

    pts = trace["points"]
    trace["distance_m"] = round(path_length_m(pts), 1) if len(pts) > 1 else 0.0
    trace["area_m2"] = round(ring_area_m2(pts + [pts[0]]), 1) if trace["kind"] == "area" and len(pts) >= 3 else 0.0

    cache.set(key, trace, TRACE_TTL)
    index = [s for s in (cache.get(_index_key(code)) or []) if s != session]
    index.append(session)
    cache.set(_index_key(code), index[-200:], TRACE_TTL)

    payload = {
        "type": "live_trace",
        "session": session,
        "enumerator": trace["enumerator"],
        "device": trace["device"],
        "kind": trace["kind"],
        "label": trace["label"],
        "color": trace["color"],
        "status": status,
        "points": [p[:2] for p in new],
        "distance_m": trace["distance_m"],
        "area_m2": trace["area_m2"],
        "total_points": len(pts),
    }
    return {"ok": True, "accepted": len(new), "last_seq": seq, "total_points": len(pts)}, payload


def active(code):
    """All traces updated within TRACE_TTL, newest first (for the live map)."""
    out = []
    for session in reversed(cache.get(_index_key(code)) or []):
        t = cache.get(_key(code, session))
        if not t or t.get("status") == "discarded":
            continue
        out.append({k: t.get(k) for k in ("session", "enumerator", "device", "kind", "label", "color",
                                          "status", "distance_m", "area_m2", "updated", "started")} |
                   {"points": [p[:2] for p in t.get("points", [])]})
    return out
