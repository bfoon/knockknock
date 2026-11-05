"""
kura/geostudio/services.py — the registry, geofencing and Kura imports.

Registry rules
──────────────
* A Location ID is derived from the boundary, not handed out from a counter:
  SHA-256(canonical geometry) → Crockford base-32 → GM-XXXX-XXXX-C.
  The same boundary always yields the same ID; a moved corner yields a new
  one. If two different boundaries ever collide on the 8-char body (1 in a
  trillion), the body is lengthened until it is unique.
* Registering a polygon that overlaps an already-registered, non-retired
  parcel is refused unless the caller passes allow_overlap (e.g. a deliberate
  lease over part of a parcel) — and the overlap is written into the ledger.
* Every change is a LandEvent whose hash covers the previous event's hash.
  verify_chain() recomputes all of them; one edited row and the record shows
  "chain broken at event #n".
"""

from __future__ import annotations

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from . import geo
from .models import Feature, GeofenceEvent, LandEvent, LocationRecord, Tracker, TrackPoint


class RegistryError(Exception):
    pass


def id_prefix():
    return str(getattr(settings, "GEO_ID_PREFIX", "GM") or "GM").upper()[:4]


def _unique_code(hexhash):
    for chars in (8, 10, 12, 16):
        code = geo.make_location_id(hexhash, prefix=id_prefix(), chars=chars)
        existing = LocationRecord.objects.filter(code=code).first()
        if not existing or existing.geometry_hash == hexhash:
            return code, existing
    raise RegistryError("Could not mint a unique Location ID.")


def overlaps(project, geometry, props=None, exclude=None):
    hits = []
    if (geometry or {}).get("type") not in ("Polygon", "MultiPolygon"):
        if geometry.get("type") == "Point" and (props or {}).get("radius"):
            geometry = geo.circle_polygon(*geometry["coordinates"], float(props["radius"]))
        else:
            return hits
    qs = LocationRecord.objects.exclude(status="retired")
    if exclude:
        qs = qs.exclude(pk=exclude)
    for r in qs.only("id", "code", "geometry", "geometry_props", "label", "status"):
        g = r.geometry
        if g.get("type") == "Point" and (r.geometry_props or {}).get("radius"):
            g = geo.circle_polygon(*g["coordinates"], float(r.geometry_props["radius"]))
        if g.get("type") in ("Polygon", "MultiPolygon") and geo.polygons_overlap(geometry, g):
            hits.append({"code": r.code, "label": r.label, "status": r.status})
    return hits


def _append(record, kind, user=None, party="", details=None, at=None):
    last = record.events.order_by("-seq").first()
    ev = LandEvent(record=record, seq=(last.seq + 1) if last else 1, kind=kind, party_name=party or "",
                   details=details or {}, actor=user if (user and user.is_authenticated) else None,
                   actor_name=(user.get_username() if user and user.is_authenticated else "system"),
                   prev_hash=last.hash if last else "", created_at=(at or timezone.now()).replace(microsecond=0))
    ev.hash = geo.chain_hash(ev.prev_hash, ev.payload())
    ev.save()
    record.head_hash = ev.hash
    record.save(update_fields=["head_hash", "updated_at"])
    return ev


@transaction.atomic
def register(project, feature, user, holder_name="", holder_contact="", tenure="customary",
             land_use="", label="", allow_overlap=False, parent=None):
    if not geo.valid_geometry(feature.geometry):
        raise RegistryError("That feature has no valid geometry.")
    h = geo.geometry_hash(feature.geometry, feature.properties)
    code, existing = _unique_code(h)
    if existing:
        raise RegistryError(f"This exact boundary is already registered as {existing.code}.")
    clash = overlaps(project, feature.geometry, feature.properties)
    if clash and not allow_overlap:
        raise RegistryError("Overlaps registered land: " + ", ".join(c["code"] for c in clash[:5])
                            + ". Adjust the boundary, or tick 'allow overlap' for a lease / easement.")
    c = geo.centroid(feature.geometry) or [0, 0]
    rec = LocationRecord.objects.create(
        project=project, feature=feature, parent=parent, code=code, geometry_hash=h,
        geometry=geo.canonical_geometry(feature.geometry) if feature.geometry.get("type") != "Point"
        else feature.geometry,
        geometry_props={"radius": feature.properties.get("radius")} if feature.properties.get("radius") else {},
        plus_code=geo.plus_code(c[1], c[0]), centroid_lat=c[1], centroid_lng=c[0],
        area_m2=geo.measure(feature.geometry, feature.properties)["area_m2"],
        label=label or feature.name, holder_name=holder_name, holder_contact=holder_contact,
        tenure=tenure, land_use=land_use, status="registered", registered_by=user,
    )
    _append(rec, "register", user, party=holder_name,
            details={"geometry_sha256": h, "hectares": round(rec.area_m2 / 10000, 4), "tenure": tenure,
                     "plus_code": rec.plus_code, "overlaps": clash})
    if feature.category in ("none", "aoi"):
        feature.category = "parcel"
        feature.save(update_fields=["category", "updated_at"])
    return rec


STATUS_AFTER = {"verify": "verified", "dispute": "disputed", "resolve": "verified", "retire": "retired"}


@transaction.atomic
def add_event(record, kind, user, party="", note="", extra=None):
    kinds = dict(LandEvent.KINDS)
    if kind not in kinds or kind == "register":
        raise RegistryError("Unknown event type.")
    if record.status == "retired" and kind != "note":
        raise RegistryError("This Location ID is retired.")
    details = {"note": note[:2000]} if note else {}
    details.update(extra or {})
    if kind in ("transfer", "allocate", "lease") and not party:
        raise RegistryError("Name the person or organisation receiving the land.")
    if kind in ("transfer", "allocate"):
        details["from"] = record.holder_name
        record.holder_name = party
    if kind in STATUS_AFTER:
        record.status = STATUS_AFTER[kind]
    record.save()
    return _append(record, kind, user, party=party, details=details)


def verify_chain(record):
    prev = ""
    events = list(record.events.order_by("seq"))
    for ev in events:
        if ev.prev_hash != prev:
            return {"ok": False, "broken_at": ev.seq, "reason": "link to previous event altered", "events": len(events)}
        if geo.chain_hash(prev, ev.payload()) != ev.hash:
            return {"ok": False, "broken_at": ev.seq, "reason": "event contents altered", "events": len(events)}
        prev = ev.hash
    geom_ok = geo.geometry_hash(record.geometry, record.geometry_props) == record.geometry_hash
    return {"ok": geom_ok and prev == record.head_hash, "geometry_ok": geom_ok, "events": len(events),
            "head": prev, "reason": "" if geom_ok else "boundary altered since registration"}


def ledger(record):
    return [{"seq": e.seq, "kind": e.kind, "label": e.get_kind_display(), "party": e.party_name,
             "details": e.details, "actor": e.actor_name, "at": e.created_at.isoformat(),
             "hash": e.hash, "prev": e.prev_hash} for e in record.events.order_by("seq")]


# ───────────────────────────── geofencing / tracking ─────────────────────────────

def fences(project):
    return list(project.features.filter(is_geofence=True).only("id", "name", "geometry", "properties"))


def fences_containing(project, lat, lng):
    return [f for f in fences(project) if geo.point_in_geometry(lng, lat, f.geometry, f.properties)]


def track(tracker, lat, lng, acc=None, speed=None):
    """Store one fix, update enter/exit state. Returns (point, events)."""
    pt = TrackPoint.objects.create(tracker=tracker, lat=lat, lng=lng, acc=acc, speed=speed)
    now_in = {str(f.id): f for f in fences_containing(tracker.project, lat, lng)}
    before = set(tracker.inside or [])
    events = []
    for fid in now_in.keys() - before:
        events.append(GeofenceEvent.objects.create(tracker=tracker, feature=now_in[fid], kind="enter", lat=lat, lng=lng))
    for fid in before - now_in.keys():
        f = Feature.objects.filter(pk=fid, project=tracker.project).first()
        if f:
            events.append(GeofenceEvent.objects.create(tracker=tracker, feature=f, kind="exit", lat=lat, lng=lng))
    tracker.inside = sorted(now_in.keys())
    tracker.last_lat, tracker.last_lng, tracker.last_acc = lat, lng, acc
    tracker.last_seen = timezone.now()
    tracker.save(update_fields=["inside", "last_lat", "last_lng", "last_acc", "last_seen"])
    return pt, events


def event_dict(e):
    return {"tracker": e.tracker.name, "tracker_id": str(e.tracker_id), "feature": e.feature.name or "geofence",
            "feature_id": str(e.feature_id), "kind": e.kind, "lat": e.lat, "lng": e.lng, "at": e.at.isoformat()}


# ───────────────────────────── Kura survey → layers ─────────────────────────────

def survey_layers(survey, limit=3000):
    """Everything spatial in a Kura survey as Geo Studio feature dicts:
    submission GPS fixes (points), mapper answers (tracks / areas / drawings)
    and the survey's geofence zones."""
    from kura.geo import mapper_names, zone_feature

    schema = (survey.current_version.schema if getattr(survey, "current_version", None) else survey.draft_schema) or {}
    names = mapper_names(schema)
    out = []
    subs = survey.submissions.exclude(status="excluded").order_by("-received_at")[:limit]
    for s in subs:
        ref = str(s.client_uuid)[:8]
        if s.gps_lat is not None and s.gps_lng is not None:
            out.append({"name": f"Response {ref}", "category": "poi", "layer": f"Kura · {survey.code} · responses",
                        "geometry": {"type": "Point", "coordinates": [s.gps_lng, s.gps_lat]},
                        "properties": {"icon": "📍", "submission": str(s.client_uuid), "source": "kura"},
                        "style": {"color": "#22d3ee"}})
        for n in names:
            v = (s.answers or {}).get(n)
            if not isinstance(v, dict):
                continue
            for f in (v.get("features") or [])[:25]:
                g = (f or {}).get("geometry")
                if not g or not geo.valid_geometry(g):
                    continue
                p = f.get("properties") or {}
                props = {"source": "kura", "submission": str(s.client_uuid), "question": n}
                if p.get("radius_m") and g.get("type") == "Point":
                    props["radius"] = float(p["radius_m"])
                cat = "road" if g.get("type") == "LineString" else ("parcel" if p.get("kind") == "area" else "aoi")
                out.append({"name": p.get("label") or f"{n} · {ref}", "category": cat,
                            "layer": f"Kura · {survey.code} · {n}", "geometry": g, "properties": props,
                            "style": {"color": p.get("color") or "#f59e0b"}})
    for z in schema.get("zones") or []:
        zf = zone_feature(z)
        if not zf:
            continue
        props = {"source": "kura-zone"}
        if zf["properties"].get("radius_m"):
            props["radius"] = zf["properties"]["radius_m"]
        out.append({"name": zf["properties"].get("label") or "Zone", "category": "geofence",
                    "layer": f"Kura · {survey.code} · zones", "geometry": zf["geometry"], "properties": props,
                    "style": {"color": zf["properties"].get("color") or "#22d3ee"}, "is_geofence": True})
    return out
