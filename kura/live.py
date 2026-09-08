"""
kura/live.py — real-time broadcast helper for the live monitor and dashboards.

Any part of the app that receives data (the web runner submit view, the
mobile sync API) calls broadcast() so every open monitor page *and* every
open live dashboard for that survey updates instantly. Deliberately
fail-safe: if Channels isn't installed, the channel layer isn't configured,
or Redis is down, data collection must never break — both surfaces simply
fall back to polling (/monitor/feed/ and the dashboard's own data endpoint).

Note the two groups. The monitor wants the submission itself; a dashboard
only wants to know that *something* changed, because it recomputes its
tiles server-side against the whole dataset. Sending the same payload to
both is fine and keeps every existing caller of broadcast() unchanged —
the dashboard client ignores the body and just re-fetches.
"""

from __future__ import annotations


def monitor_group(code: str) -> str:
    return f"kura_mon_{code.upper()}"


def dashboard_group(code: str) -> str:
    return f"kura_dash_{code.upper()}"


def broadcast(code: str, payload: dict) -> None:
    try:
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        layer = get_channel_layer()
        if layer is None:
            return
        for group in (monitor_group(code), dashboard_group(code)):
            async_to_sync(layer.group_send)(
                group, {"type": "fanout", "payload": payload}
            )
    except Exception:
        # Live updates are a bonus; never let them break collection.
        pass


def dashboard_changed(code: str, reason: str = "data") -> None:
    """Nudge dashboards without touching the monitor.

    Call this after anything that changes what a board should show but is
    not a new submission — a pipeline edit, a bulk status change, a
    cleaning run. Cheap enough to call liberally.
    """
    try:
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        layer = get_channel_layer()
        if layer is None:
            return
        async_to_sync(layer.group_send)(
            dashboard_group(code),
            {"type": "fanout", "payload": {"type": "data_changed", "reason": reason}},
        )
    except Exception:
        pass


def submission_summary(sub) -> dict:
    """The lightweight shape the monitor feed and WS events share."""
    return {
        "id": sub.id,
        "uuid": str(sub.client_uuid),
        "source": sub.source,
        "status": sub.status,
        "device": sub.device.name if sub.device_id else None,
        "platform": sub.device.platform if sub.device_id else "",
        "enumerator": sub.enumerator.get_username() if sub.enumerator_id else None,
        "gps": ([sub.gps_lat, sub.gps_lng]
                if sub.gps_lat is not None and sub.gps_lng is not None else None),
        "duration_ms": sub.duration_ms,
        "version": sub.form_version.version if sub.form_version_id else None,
        "received_at": sub.received_at.isoformat() if sub.received_at else None,
    }
