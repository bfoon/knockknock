"""
kura/live.py — real-time broadcast helper for the live monitor.

Any part of the app that receives data (the web runner submit view, the
mobile sync API) calls broadcast() so every open monitor page for that
survey updates instantly. Deliberately fail-safe: if Channels isn't
installed, the channel layer isn't configured, or Redis is down, data
collection must never break — the monitor page simply falls back to
polling /monitor/feed/.
"""

from __future__ import annotations


def monitor_group(code: str) -> str:
    return f"kura_mon_{code.upper()}"


def broadcast(code: str, payload: dict) -> None:
    try:
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        layer = get_channel_layer()
        if layer is None:
            return
        async_to_sync(layer.group_send)(
            monitor_group(code), {"type": "fanout", "payload": payload}
        )
    except Exception:
        # Live updates are a bonus; never let them break collection.
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
