"""
kura/geostudio/views.py — pages + JSON API for Kura Geo Studio.

Mounted at /kura/geo/ (see config/urls.py — it must sit BEFORE the Kura
include, whose "<code>/…" routes would otherwise swallow "geo/…").

Pages
    /kura/geo/                       my geo projects
    /kura/geo/p/<id>/                the studio
    /kura/geo/p/<id>/report/         printable MRV / registry report (owner)
    /kura/geo/r/<token>/             public MRV report (when sharing is on)
    /kura/geo/id/<code>/             public Location ID verification page
    /kura/geo/t/<token>/             phone tracker page (share GPS)
JSON
    /kura/geo/p/<id>/api/…           studio API (owner only)
    /kura/geo/t/<token>/ping/        tracker fix (POST, token auth)
    /kura/geo/lookup/<code>.json     public Location ID lookup
"""

from __future__ import annotations

import json
import uuid
from datetime import date

from django.contrib.auth.decorators import login_required
from django.core.files.base import ContentFile
from django.db.models import Count, Sum
from django.http import Http404, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from . import ai, carbon, detect, fit, geo, imagery, services
from .models import (Analysis, CarbonAsset, Feature, GeofenceEvent, GeoProject, ImageryLayer,
                     LocationRecord, Tracker)

MAX_FEATURES = 5000
MAX_GEOM_BYTES = 400_000
HEX_OK = set("0123456789abcdefABCDEF#")


# ───────────────────────────── helpers ─────────────────────────────

def _body(request):
    try:
        return json.loads(request.body.decode("utf-8") or "{}")
    except (ValueError, UnicodeDecodeError):
        return {}


def _own(request, pk):
    p = get_object_or_404(GeoProject, pk=pk)
    if not p.can_edit(request.user):
        raise Http404
    return p


def _err(msg, status=400):
    return JsonResponse({"ok": False, "error": msg}, status=status)


def _broadcast(project_id, payload):
    try:
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer
        layer = get_channel_layer()
        if layer:
            async_to_sync(layer.group_send)(f"kura_geo_{project_id}", {"type": "fanout", "payload": payload})
    except Exception:
        pass


def _clean_style(s):
    s = s if isinstance(s, dict) else {}
    out = {}
    for k in ("color", "fillColor"):
        v = str(s.get(k) or "")
        if v and len(v) <= 9 and set(v) <= HEX_OK and v.startswith("#"):
            out[k] = v
    for k, lo, hi in (("weight", 0, 20), ("opacity", 0, 1), ("fillOpacity", 0, 1), ("fontSize", 8, 72),
                      ("iconSize", 12, 96)):
        if k in s:
            try:
                out[k] = max(lo, min(hi, float(s[k])))
            except (TypeError, ValueError):
                pass
    if s.get("dashArray") in ("", "6 4", "2 6", "12 6", "1 4", "10 4 2 4"):
        out["dashArray"] = s["dashArray"]
    if s.get("pattern") in ("none", "hatch", "dots", "cross"):
        out["pattern"] = s["pattern"]
    return out


def _clean_props(p):
    p = p if isinstance(p, dict) else {}
    out = {}
    if p.get("radius") not in (None, ""):
        try:
            out["radius"] = max(0.5, min(200000.0, float(p["radius"])))
        except (TypeError, ValueError):
            pass
    for k, n in (("text", 300), ("icon", 16), ("shape", 20), ("source", 20), ("submission", 40),
                 ("question", 80), ("detected", 20)):
        if p.get(k) not in (None, ""):
            out[k] = str(p[k])[:n]
    fields = p.get("fields")
    if isinstance(fields, dict):
        out["fields"] = {str(k)[:40]: str(v)[:300] for k, v in list(fields.items())[:30]}
    return out


def _apply_feature(f, d):
    if "geometry" in d:
        g = d["geometry"]
        if not geo.valid_geometry(g) or len(json.dumps(g)) > MAX_GEOM_BYTES:
            raise ValueError("Invalid or oversized geometry.")
        f.geometry = g
    if "properties" in d:
        f.properties = _clean_props(d["properties"])
    if "style" in d:
        f.style = _clean_style(d["style"])
    if "name" in d:
        f.name = str(d["name"] or "")[:160]
    if "category" in d and d["category"] in dict(Feature.CATEGORIES):
        f.category = d["category"]
    if "layer" in d:
        f.layer = (str(d["layer"] or "Main").strip() or "Main")[:80]
    if "notes" in d:
        f.notes = str(d["notes"] or "")[:5000]
    for k in ("is_geofence", "locked", "hidden"):
        if k in d:
            setattr(f, k, bool(d[k]))
    if "z" in d:
        try:
            f.z_index = int(d["z"])
        except (TypeError, ValueError):
            pass
    if f.category == "geofence":
        f.is_geofence = True
    f.remeasure()


def _asset_dict(a, analyses=None):
    feat = a.feature
    ha = feat.area_m2 / 10000.0
    latest = None
    timeline = []
    qs = analyses if analyses is not None else a.feature.analyses.all()
    for an in sorted(qs, key=lambda x: x.created_at):
        s = (an.result or {}).get("summary", {})
        timeline.append({"at": an.created_at.isoformat(), "canopy_ha": s.get("canopy_ha"),
                         "canopy_pct": s.get("canopy_pct"), "trees": s.get("tree_count"),
                         "solar_m2": s.get("solar_area_m2"), "id": str(an.id)})
        latest = s
    years = 1.0
    if a.planted_on:
        years = max(0.1, (date.today() - a.planted_on).days / 365.25)
    canopy_frac = None
    if latest and latest.get("canopy_pct") is not None and a.ecosystem != "solar":
        canopy_frac = min(1.0, float(latest["canopy_pct"]) / 100.0)
    est_annual = carbon.estimate(a.ecosystem, ha, 1.0, canopy_frac, a.overrides,
                                 panel_area_m2=(latest or {}).get("solar_area_m2"), price_usd=a.price_usd)
    est_total = carbon.estimate(a.ecosystem, ha, years, canopy_frac, a.overrides,
                                panel_area_m2=(latest or {}).get("solar_area_m2"), price_usd=a.price_usd)
    verification = {}
    if a.claimed_hectares:
        verification["hectares_claimed"] = a.claimed_hectares
        verification["hectares_mapped"] = round(ha, 4)
        verification["hectares_diff_pct"] = round((ha - a.claimed_hectares) / a.claimed_hectares * 100, 1)
    if latest and latest.get("canopy_ha") is not None and a.claimed_hectares:
        verification["canopy_vs_claim_pct"] = round(latest["canopy_ha"] / a.claimed_hectares * 100, 1)
    if a.claimed_trees:
        verification["trees_claimed"] = a.claimed_trees
        if latest and latest.get("tree_count"):
            verification["trees_detected"] = latest["tree_count"]
            verification["survival_pct"] = round(latest["tree_count"] / a.claimed_trees * 100, 1)
    eco = carbon.ECOSYSTEMS.get(a.ecosystem, {})
    return {"id": str(a.id), "feature_id": str(a.feature_id), "feature_name": feat.name or "Untitled area",
            "ecosystem": a.ecosystem, "ecosystem_label": eco.get("label", a.ecosystem), "icon": eco.get("icon", ""),
            "planted_on": a.planted_on.isoformat() if a.planted_on else None, "years": round(years, 2),
            "claimed_trees": a.claimed_trees, "claimed_hectares": a.claimed_hectares, "status": a.status,
            "status_label": a.get_status_display(), "price_usd": a.price_usd, "overrides": a.overrides,
            "notes": a.notes, "hectares": round(ha, 4), "annual": est_annual, "to_date": est_total,
            "verification": verification, "timeline": timeline, "latest": latest}


def _state(p):
    feats = [f.as_dict() for f in p.features.all()[:MAX_FEATURES]]
    analyses = list(p.analyses.all()[:60])
    assets = list(p.carbon_assets.select_related("feature").prefetch_related("feature__analyses"))
    return {
        "project": {"id": str(p.id), "title": p.title, "description": p.description, "purpose": p.purpose,
                    "center": [p.center_lat, p.center_lng], "zoom": p.zoom, "basemap": p.basemap,
                    "is_public": p.is_public, "share_token": p.share_token,
                    "survey": p.survey.code if p.survey_id else None},
        "features": feats,
        "records": [r.as_dict() for r in p.records.all()[:2000]],
        "analyses": [a.as_dict(full=False) for a in analyses],
        "assets": [_asset_dict(a) for a in assets],
        "trackers": [t.as_dict() for t in p.trackers.all()],
        "imagery": [i.as_dict() for i in p.imagery.all()],
        "events": [services.event_dict(e) for e in
                   GeofenceEvent.objects.filter(tracker__project=p).select_related("tracker", "feature")[:50]],
    }


# ───────────────────────────── pages ─────────────────────────────

@login_required
def project_list(request):
    projects = (GeoProject.objects.filter(owner=request.user)
                .annotate(n_features=Count("features", distinct=True), n_records=Count("records", distinct=True)))
    from kura.models import Survey
    surveys = Survey.objects.filter(owner=request.user).order_by("-updated_at")[:50]
    totals = {
        "projects": projects.count(),
        "hectares": round((Feature.objects.filter(project__owner=request.user).aggregate(s=Sum("area_m2"))["s"] or 0) / 10000, 1),
        "records": LocationRecord.objects.filter(project__owner=request.user).count(),
        "analyses": Analysis.objects.filter(project__owner=request.user).count(),
    }
    return render(request, "kura/geo/list.html", {"projects": projects, "surveys": surveys, "totals": totals,
                                                  "purposes": GeoProject.PURPOSES})


@login_required
@require_POST
def project_create(request):
    from kura.models import Survey
    p = GeoProject(owner=request.user, title=(request.POST.get("title") or "Untitled map").strip()[:160],
                   purpose=request.POST.get("purpose") if request.POST.get("purpose") in dict(GeoProject.PURPOSES) else "general",
                   description=(request.POST.get("description") or "")[:2000])
    code = (request.POST.get("survey") or request.GET.get("survey") or "").strip().upper()
    s = Survey.objects.filter(code=code, owner=request.user).first() if code else None
    if s:
        p.survey = s
    p.save()
    if s:
        _import_survey(p, s, request.user)
    return redirect("kura_geo:studio", pk=p.pk)


@login_required
def from_survey(request, code):
    """One click from a Kura survey: open (or create) its Geo Studio project."""
    from kura.models import Survey
    s = get_object_or_404(Survey, code=code.upper(), owner=request.user)
    p = GeoProject.objects.filter(owner=request.user, survey=s).first()
    if not p:
        p = GeoProject.objects.create(owner=request.user, survey=s, title=f"{s.title} · Geo", purpose="general")
        _import_survey(p, s, request.user)
    return redirect("kura_geo:studio", pk=p.pk)


@login_required
@require_POST
def project_delete(request, pk):
    p = _own(request, pk)
    p.delete()
    return redirect("kura_geo:list")


@login_required
def studio(request, pk):
    p = _own(request, pk)
    from kura.models import Survey
    cfg = {
        "id": str(p.id),
        "api": reverse("kura_geo:studio", args=[p.id]) + "api/",
        "ws": f"/ws/kura/geo/{p.id}/",
        "imagery_url": imagery.tile_url(), "imagery_attribution": imagery.attribution(),
        "imagery_max_zoom": imagery.max_zoom(),
        "ai_enabled": _ai_enabled(),
        "categories": Feature.CATEGORIES, "tenures": LocationRecord.TENURES, "events": LandEvent_kinds(),
        "ecosystems": {k: {"label": v["label"], "icon": v["icon"], "color": v["color"],
                           "seq": v["seq_t_ha_yr"], "methodology": v["methodology"]} for k, v in carbon.ECOSYSTEMS.items()},
        "verify_base": request.build_absolute_uri(reverse("kura_geo:verify", args=["CODE"])).replace("CODE/", ""),
        "tracker_base": request.build_absolute_uri("/kura/geo/t/"),
        "report_url": reverse("kura_geo:report", args=[p.id]),
        "public_report": request.build_absolute_uri(reverse("kura_geo:public_report", args=[p.share_token])),
        "surveys": [{"code": s.code, "title": s.title} for s in Survey.objects.filter(owner=request.user).order_by("-updated_at")[:60]],
        "id_prefix": services.id_prefix(),
    }
    return render(request, "kura/geo/studio.html", {"project": p, "cfg": cfg})


def LandEvent_kinds():
    from .models import LandEvent
    return [k for k in LandEvent.KINDS if k[0] != "register"]


def _ai_enabled():
    try:
        from hanns import ai as hai
        return hai.is_enabled()
    except Exception:
        return False


def _report_ctx(p):
    st = _state(p)
    feats = list(p.features.all())
    by_cat = {}
    for f in feats:
        c = by_cat.setdefault(f.get_category_display(), {"count": 0, "ha": 0.0, "km": 0.0})
        c["count"] += 1
        c["ha"] += f.area_m2 / 10000
        c["km"] += f.length_m / 1000 if f.geometry.get("type") == "LineString" else 0
    totals = {"credits": sum(a["to_date"]["credits"] for a in st["assets"]),
              "annual": round(sum(a["annual"]["net_tco2e"] for a in st["assets"]), 1),
              "ha": round(sum(a["hectares"] for a in st["assets"]), 2),
              "value": round(sum(a["to_date"].get("value_usd") or 0 for a in st["assets"]), 2)}
    return {"project": p, "state": st, "state_json": st, "by_cat": sorted(by_cat.items()), "totals": totals,
            "analyses": p.analyses.select_related("feature")[:30],
            "generated": timezone.now(), "attribution": imagery.attribution(),
            "imagery_url": imagery.tile_url()}


@login_required
def report(request, pk):
    p = _own(request, pk)
    ctx = _report_ctx(p)
    ctx["private"] = True
    ctx["records"] = [r.as_dict() for r in p.records.all()[:500]]
    return render(request, "kura/geo/report.html", ctx)


def public_report(request, token):
    p = get_object_or_404(GeoProject, share_token=token, is_public=True)
    ctx = _report_ctx(p)
    ctx["private"] = False
    ctx["records"] = [r.as_dict(private=False) for r in p.records.all()[:500]]
    # never ship holder contacts or tracker tokens on a public page
    ctx["state_json"] = dict(ctx["state"], trackers=[], events=[],
                             records=ctx["records"])
    return render(request, "kura/geo/report.html", ctx)


def verify(request, code):
    norm = geo.normalise_location_id(code)
    rec = LocationRecord.objects.filter(code=norm).select_related("project").first()
    valid = geo.location_id_valid(norm)
    ctx = {"code": norm, "valid_format": valid, "record": rec,
           "imagery_url": imagery.tile_url(), "attribution": imagery.attribution()}
    if rec:
        ctx["chain"] = services.verify_chain(rec)
        from .models import _mask
        ctx["ledger"] = [dict(e, party=_mask(e["party"])) for e in services.ledger(rec)]
        ctx["pub"] = rec.as_dict(private=False)
        ctx["qr"] = _qr(request.build_absolute_uri())
        ctx["children"] = rec.children.all()
    return render(request, "kura/geo/verify.html", ctx)


@require_GET
def lookup(request, code):
    norm = geo.normalise_location_id(code)
    rec = LocationRecord.objects.filter(code=norm).first()
    if not rec:
        return JsonResponse({"ok": False, "valid_format": geo.location_id_valid(norm), "code": norm}, status=404)
    d = rec.as_dict(private=False)
    d["chain"] = services.verify_chain(rec)
    resp = JsonResponse({"ok": True, "record": d})
    resp["Access-Control-Allow-Origin"] = "*"
    return resp


def _qr(text):
    try:
        import base64
        import io
        import qrcode
        img = qrcode.make(text, box_size=6, border=2)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return ""


# ───────────────────────────── tracker (public, token) ─────────────────────────────

def tracker_page(request, token):
    t = get_object_or_404(Tracker, token=token)
    fences = [{"name": f.name, "geometry": f.geometry, "properties": f.properties, "style": f.style}
              for f in services.fences(t.project)]
    return render(request, "kura/geo/tracker.html", {"tracker": t, "fences": fences,
                                                     "imagery_url": imagery.tile_url()})


@csrf_exempt          # authenticated by the unguessable tracker token, not a session
@require_POST
def tracker_ping(request, token):
    t = get_object_or_404(Tracker, token=token)
    if not t.active:
        return _err("This tracker has been switched off.", 403)
    d = _body(request)
    try:
        lat, lng = float(d["lat"]), float(d["lng"])
    except (KeyError, TypeError, ValueError):
        return _err("lat/lng required")
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return _err("bad coordinates")
    acc = d.get("acc")
    acc = float(acc) if isinstance(acc, (int, float)) else None
    spd = d.get("speed")
    spd = float(spd) if isinstance(spd, (int, float)) else None
    _, events = services.track(t, lat, lng, acc, spd)
    payload = {"type": "tracker", "tracker": t.as_dict()}
    payload["tracker"].pop("token", None)
    _broadcast(t.project_id, payload)
    for e in events:
        _broadcast(t.project_id, {"type": "geofence_event", "event": services.event_dict(e)})
    inside = [f.name or "geofence" for f in Feature.objects.filter(pk__in=t.inside)]
    return JsonResponse({"ok": True, "inside": inside, "events": [services.event_dict(e) for e in events]})


# ───────────────────────────── studio API ─────────────────────────────

@login_required
def api(request, pk, action, oid=None):
    p = _own(request, pk)
    handler = API.get(action)
    if not handler:
        raise Http404
    method, fn = handler
    if method == "POST" and request.method != "POST":
        return _err("POST required", 405)
    try:
        return fn(request, p, oid)
    except (ValueError, services.RegistryError, imagery.ImageryError, fit.FitError) as e:
        return _err(str(e))


def a_state(request, p, oid):
    return JsonResponse({"ok": True, **_state(p)})


def a_project(request, p, oid):
    d = _body(request)
    for k, n in (("title", 160), ("description", 2000)):
        if k in d:
            setattr(p, k, str(d[k] or "")[:n])
    if d.get("purpose") in dict(GeoProject.PURPOSES):
        p.purpose = d["purpose"]
    if d.get("basemap") in ("satellite", "streets", "dark", "topo", "hybrid"):
        p.basemap = d["basemap"]
    if "center" in d:
        try:
            p.center_lat, p.center_lng = float(d["center"][0]), float(d["center"][1])
            p.zoom = int(d.get("zoom") or p.zoom)
        except (TypeError, ValueError, IndexError):
            pass
    if "is_public" in d:
        p.is_public = bool(d["is_public"])
    if d.get("rotate_share"):
        import secrets
        p.share_token = secrets.token_urlsafe(16)
    p.save()
    return JsonResponse({"ok": True, "is_public": p.is_public, "share_token": p.share_token})


def a_feature_save(request, p, oid):
    d = _body(request)
    if oid:
        f = get_object_or_404(Feature, pk=oid, project=p)
        if f.locked and not ("locked" in d and set(d) <= {"locked", "hidden"}):
            return _err("This feature is locked. Unlock it first.")
    else:
        if p.features.count() >= MAX_FEATURES:
            return _err("This project has reached its feature limit.")
        f = Feature(project=p, created_by=request.user)
        try:
            if d.get("id"):
                f.id = uuid.UUID(str(d["id"]))
        except ValueError:
            pass
    _apply_feature(f, d)
    f.save()
    out = f.as_dict()
    _broadcast(p.id, {"type": "feature", "feature": out, "by": request.user.id})
    return JsonResponse({"ok": True, "feature": out})


def a_feature_bulk(request, p, oid):
    d = _body(request)
    items = d.get("features") or []
    if not isinstance(items, list):
        return _err("features must be a list")
    room = MAX_FEATURES - p.features.count()
    made = []
    for it in items[:max(0, min(room, 3000))]:
        if not isinstance(it, dict):
            continue
        f = Feature(project=p, created_by=request.user)
        try:
            _apply_feature(f, it)
        except ValueError:
            continue
        made.append(f)
    Feature.objects.bulk_create(made, batch_size=500)
    return JsonResponse({"ok": True, "created": len(made), "features": [f.as_dict() for f in made]})


def a_feature_delete(request, p, oid):
    f = get_object_or_404(Feature, pk=oid, project=p)
    if f.locked:
        return _err("This feature is locked.")
    if f.records.exclude(status="retired").exists():
        return _err("This feature carries a registered Location ID. Retire the ID first — registry history is never deleted.")
    f.delete()
    _broadcast(p.id, {"type": "feature_deleted", "id": str(oid), "by": request.user.id})
    return JsonResponse({"ok": True})


def a_layer(request, p, oid):
    """Rename / hide / delete a whole layer."""
    d = _body(request)
    name = str(d.get("layer") or "")
    qs = p.features.filter(layer=name)
    if d.get("op") == "rename" and d.get("to"):
        qs.update(layer=str(d["to"])[:80])
    elif d.get("op") == "hide":
        qs.update(hidden=bool(d.get("hidden")))
    elif d.get("op") == "delete":
        qs.filter(locked=False, records__isnull=True).delete()
    return JsonResponse({"ok": True, **_state(p)})


def a_analyze(request, p, oid):
    d = _body(request)
    kind = d.get("kind") if d.get("kind") in dict(Analysis.KINDS) else "full"
    engine = d.get("engine") if d.get("engine") in dict(Analysis.ENGINES) else "hybrid"
    feature = None
    props = {}
    if d.get("feature_id"):
        feature = get_object_or_404(Feature, pk=d["feature_id"], project=p)
        geometry, props = feature.geometry, feature.properties
    else:
        geometry = d.get("geometry")
        props = _clean_props(d.get("properties"))
    if not geo.valid_geometry(geometry):
        return _err("Select or draw an area to analyse.")
    if geometry.get("type") not in ("Polygon", "MultiPolygon") and not props.get("radius"):
        return _err("Analysis needs an area (polygon, rectangle or circle), not a line or point.")
    if geo.measure(geometry, props)["area_m2"] > 2.5e7:
        return _err("That area is over 2,500 ha — split it into smaller blocks for a sharp analysis.")
    layer = None
    if d.get("imagery_id"):
        layer = get_object_or_404(ImageryLayer, pk=d["imagery_id"], project=p)
        frame = imagery.from_upload(layer, geometry)
    else:
        frame = imagery.from_tiles(geometry, zoom=d.get("zoom"))
    ctx = ""
    if feature:
        ctx = f"Area named '{feature.name}' tagged as {feature.get_category_display()}."
    try:
        result, overlay, snap = detect.run(frame, geometry, props, kind=kind, engine=engine,
                                           user_id=request.user.id, context=ctx)
    except Exception as e:
        from hanns.ai import AIError
        if isinstance(e, AIError):
            return _err(str(e), getattr(e, "status", 502))
        raise
    an = Analysis(project=p, feature=feature, imagery=layer, kind=kind, engine=engine,
                  zoom=frame.zoom or 0, aoi=geometry, result=result, bounds=result["bounds"],
                  snapshot_sha256=result["snapshot_sha256"], created_by=request.user)
    an.overlay.save(f"{an.id}.png", ContentFile(overlay), save=False)
    an.snapshot.save(f"{an.id}.jpg", ContentFile(snap), save=False)
    an.save()
    out = an.as_dict()
    _broadcast(p.id, {"type": "analysis", "analysis": an.as_dict(full=False)})
    return JsonResponse({"ok": True, "analysis": out})


def a_fit(request, p, oid):
    """Trace the real outline of what's under a box (or a Wand click).
    Returns a preview geometry — nothing is saved until the user accepts."""
    d = _body(request)
    props = {}
    point = None
    if d.get("feature_id"):
        f = get_object_or_404(Feature, pk=d["feature_id"], project=p)
        seed, props = f.geometry, f.properties
    elif isinstance(d.get("point"), list) and len(d["point"]) == 2:
        try:
            point = [float(d["point"][0]), float(d["point"][1])]
        except (TypeError, ValueError):
            return _err("Bad point.")
        r = max(2.0, min(80.0, float(d.get("seed_m") or 8)))
        seed = geo.circle_polygon(point[0], point[1], r, steps=16)
    else:
        seed = d.get("geometry")
        props = _clean_props(d.get("properties"))
    if not geo.valid_geometry(seed):
        return _err("Select a box or shape first.")
    if seed.get("type") not in ("Polygon", "MultiPolygon") and not props.get("radius"):
        return _err("Fit works from an area — a box, shape or circle.")
    reach = d.get("reach_m")
    try:
        reach = None if reach in (None, "") else max(0.0, min(1500.0, float(reach)))
    except (TypeError, ValueError):
        reach = None
    if point and reach is None:
        reach = 250.0
    layer = get_object_or_404(ImageryLayer, pk=d["imagery_id"], project=p) if d.get("imagery_id") else None
    frame = fit.frame_for(seed, props, reach_m=reach, zoom=d.get("zoom"), layer=layer, point=point)
    try:
        tol = float(d.get("tolerance", 0.5))
        smooth = int(d.get("smooth", 1))
    except (TypeError, ValueError):
        tol, smooth = 0.5, 1
    g, stats = fit.trace(frame, seed, props, target=d.get("target") or "auto", tolerance=tol,
                         smooth=max(0, min(3, smooth)), keep_inside=bool(d.get("keep_inside")), point=point)
    return JsonResponse({"ok": True, "geometry": g, "stats": stats})


def a_analysis(request, p, oid):
    an = get_object_or_404(Analysis, pk=oid, project=p)
    if request.method == "POST" and _body(request).get("delete"):
        an.overlay.delete(save=False)
        an.snapshot.delete(save=False)
        an.delete()
        return JsonResponse({"ok": True})
    return JsonResponse({"ok": True, "analysis": an.as_dict()})


def a_detections_to_features(request, p, oid):
    """Turn an analysis's detections into editable features (one layer)."""
    an = get_object_or_404(Analysis, pk=oid, project=p)
    d = _body(request)
    want = set(d.get("labels") or [])
    dets = [x for x in (an.result or {}).get("detections", []) if not want or x.get("label") in want]
    layer = f"Detected · {an.created_at:%Y-%m-%d %H:%M}"
    made = []
    icons = {"tree": "🌳", "palm": "🌴", "mangrove": "🌿", "solar": "☀️", "building": "🏠", "water": "💧"}
    cats = {"tree": "forest", "palm": "palm", "mangrove": "mangrove", "solar": "solar", "building": "building", "water": "water"}
    for x in dets[:3000 - p.features.count() if p.features.count() < 3000 else 0]:
        if x.get("polygon") and x.get("label") in ("solar", "building"):
            g = {"type": "Polygon", "coordinates": [x["polygon"]]}
            st = {"color": detect.LABEL_COLORS.get(x["label"], "#facc15"), "fillOpacity": 0.25, "weight": 1}
            pr = {"detected": x.get("source", "")}
        else:
            g = {"type": "Point", "coordinates": [x["lng"], x["lat"]]}
            st = {"iconSize": 18}
            pr = {"icon": icons.get(x["label"], "📍"), "detected": x.get("source", "")}
        f = Feature(project=p, created_by=request.user, layer=layer, name=x.get("raw_label") or x["label"],
                    category=cats.get(x["label"], "poi"), geometry=g, properties=pr, style=st)
        f.remeasure()
        made.append(f)
    Feature.objects.bulk_create(made, batch_size=500)
    return JsonResponse({"ok": True, "created": len(made), "features": [f.as_dict() for f in made]})


def a_register(request, p, oid):
    d = _body(request)
    f = get_object_or_404(Feature, pk=d.get("feature_id"), project=p)
    parent = None
    if d.get("parent"):
        parent = LocationRecord.objects.filter(code=geo.normalise_location_id(d["parent"]), project=p).first()
    rec = services.register(p, f, request.user, holder_name=str(d.get("holder_name") or "")[:160],
                            holder_contact=str(d.get("holder_contact") or "")[:160],
                            tenure=d.get("tenure") if d.get("tenure") in dict(LocationRecord.TENURES) else "customary",
                            land_use=str(d.get("land_use") or "")[:80], label=str(d.get("label") or "")[:160],
                            allow_overlap=bool(d.get("allow_overlap")), parent=parent)
    if parent:
        services.add_event(parent, "subdivide", request.user, party=rec.holder_name,
                           extra={"child": rec.code, "hectares": round(rec.area_m2 / 10000, 4)})
    return JsonResponse({"ok": True, "record": rec.as_dict(), "feature": f.as_dict()})


def a_record(request, p, oid):
    rec = get_object_or_404(LocationRecord, pk=oid, project=p)
    if request.method == "POST":
        d = _body(request)
        if d.get("kind"):
            services.add_event(rec, d["kind"], request.user, party=str(d.get("party") or "")[:160],
                               note=str(d.get("note") or ""))
        for k in ("holder_contact", "land_use", "label"):
            if k in d:
                setattr(rec, k, str(d[k] or "")[:160])
        if d.get("tenure") in dict(LocationRecord.TENURES):
            rec.tenure = d["tenure"]
        rec.save()
    return JsonResponse({"ok": True, "record": rec.as_dict(), "ledger": services.ledger(rec),
                         "chain": services.verify_chain(rec),
                         "overlaps": services.overlaps(p, rec.geometry, rec.geometry_props, exclude=rec.pk)})


def a_check_overlap(request, p, oid):
    d = _body(request)
    f = get_object_or_404(Feature, pk=d.get("feature_id"), project=p)
    own = set(f.records.values_list("pk", flat=True))
    clash = [c for c in services.overlaps(p, f.geometry, f.properties)
             if not LocationRecord.objects.filter(code=c["code"], pk__in=own).exists()]
    return JsonResponse({"ok": True, "overlaps": clash,
                         "preview_id": geo.make_location_id(geo.geometry_hash(f.geometry, f.properties), services.id_prefix()),
                         "hash": geo.geometry_hash(f.geometry, f.properties),
                         "plus_code": geo.plus_code(f.centroid_lat or 0, f.centroid_lng or 0)})


def a_asset(request, p, oid):
    d = _body(request)
    if oid:
        a = get_object_or_404(CarbonAsset, pk=oid, project=p)
        if d.get("delete"):
            a.delete()
            return JsonResponse({"ok": True})
    else:
        f = get_object_or_404(Feature, pk=d.get("feature_id"), project=p)
        a = CarbonAsset(project=p, feature=f)
    if d.get("ecosystem") in carbon.ECOSYSTEMS:
        a.ecosystem = d["ecosystem"]
    if "planted_on" in d:
        try:
            a.planted_on = date.fromisoformat(d["planted_on"]) if d["planted_on"] else None
        except ValueError:
            pass
    for k, cast in (("claimed_trees", int), ("claimed_hectares", float)):
        if k in d:
            try:
                setattr(a, k, max(0, cast(d[k] or 0)))
            except (TypeError, ValueError):
                pass
    if "price_usd" in d:
        try:
            a.price_usd = float(d["price_usd"]) if d["price_usd"] not in (None, "") else None
        except (TypeError, ValueError):
            pass
    if isinstance(d.get("overrides"), dict):
        ov = {}
        for k, v in d["overrides"].items():
            if k in ("seq_t_ha_yr", "buffer", "kwp_per_m2", "yield_kwh_kwp_yr", "grid_ef_t_mwh", "performance_ratio"):
                try:
                    ov[k] = float(v)
                except (TypeError, ValueError):
                    pass
        a.overrides = ov
    if d.get("status") in dict(CarbonAsset.STATUSES):
        a.status = d["status"]
    if "notes" in d:
        a.notes = str(d["notes"] or "")[:4000]
    a.save()
    if a.feature.category in ("none", "aoi") and a.ecosystem in dict(Feature.CATEGORIES):
        a.feature.category = a.ecosystem
        a.feature.save(update_fields=["category", "updated_at"])
    return JsonResponse({"ok": True, "asset": _asset_dict(a)})


def a_tracker(request, p, oid):
    d = _body(request)
    if oid:
        t = get_object_or_404(Tracker, pk=oid, project=p)
        if d.get("delete"):
            t.delete()
            return JsonResponse({"ok": True})
        if "active" in d:
            t.active = bool(d["active"])
        if d.get("trail"):
            pts = list(t.points.order_by("-at")[:2000].values_list("lat", "lng", "at"))
            pts.reverse()
            return JsonResponse({"ok": True, "trail": [[a, b, c.isoformat()] for a, b, c in pts]})
    else:
        t = Tracker(project=p, name=(str(d.get("name") or "Field phone").strip() or "Field phone")[:80])
    c = str(d.get("color") or "")
    if c.startswith("#") and len(c) <= 9 and set(c) <= HEX_OK:
        t.color = c
    t.save()
    return JsonResponse({"ok": True, "tracker": t.as_dict()})


def a_geofence_check(request, p, oid):
    try:
        lat, lng = float(request.GET.get("lat")), float(request.GET.get("lng"))
    except (TypeError, ValueError):
        return _err("lat & lng required")
    hits = services.fences_containing(p, lat, lng)
    recs = [r.code for r in p.records.exclude(status="retired")
            if geo.point_in_geometry(lng, lat, r.geometry, r.geometry_props)]
    return JsonResponse({"ok": True, "inside": [{"id": str(f.id), "name": f.name} for f in hits],
                         "location_ids": recs, "plus_code": geo.plus_code(lat, lng)})


def a_imagery(request, p, oid):
    if oid:
        lay = get_object_or_404(ImageryLayer, pk=oid, project=p)
        d = _body(request)
        if d.get("delete"):
            lay.file.delete(save=False)
            lay.delete()
            return JsonResponse({"ok": True})
        if "opacity" in d:
            lay.opacity = max(0.0, min(1.0, float(d["opacity"])))
        if isinstance(d.get("bounds"), list) and len(d["bounds"]) == 4:
            lay.bounds = [float(v) for v in d["bounds"]]
        lay.save()
        return JsonResponse({"ok": True, "imagery": lay.as_dict()})
    f = request.FILES.get("file")
    if not f:
        return _err("Choose an image file.")
    if f.size > 60 * 1024 * 1024:
        return _err("Image is over 60 MB — export a smaller JPEG/PNG orthophoto.")
    if not (f.content_type or "").startswith("image/"):
        return _err("Upload a JPEG or PNG (export GeoTIFFs to JPEG with their bounds first).")
    try:
        b = [float(request.POST.get(k)) for k in ("west", "south", "east", "north")]
    except (TypeError, ValueError):
        return _err("Bounds are required (west, south, east, north).")
    if not (b[0] < b[2] and b[1] < b[3]):
        return _err("Bounds are the wrong way round.")
    cap = request.POST.get("captured_on")
    lay = ImageryLayer(project=p, name=(request.POST.get("name") or f.name)[:160], bounds=b)
    try:
        lay.captured_on = date.fromisoformat(cap) if cap else None
    except ValueError:
        pass
    lay.file.save(f"{uuid.uuid4().hex}_{f.name[-60:]}", f, save=False)
    lay.save()
    return JsonResponse({"ok": True, "imagery": lay.as_dict()})


def a_ai(request, p, oid):
    d = _body(request)
    msg = str(d.get("message") or "").strip()[:600]
    if not msg:
        return _err("Type something to search or ask.")
    ctx = {
        "view": d.get("view"), "selected": d.get("selected"),
        "categories": sorted({f.category for f in p.features.all()[:2000]}),
        "feature_names": [f.name for f in p.features.exclude(name="")[:80]],
        "purpose": p.purpose, "project": p.title,
    }
    out = ai.plan(msg, ctx, user_id=request.user.id, use_ai=bool(d.get("ai", True)))
    return JsonResponse({"ok": True, **out})


def a_search(request, p, oid):
    q = (request.GET.get("q") or "").strip()
    res = {"features": [], "records": [], "places": []}
    if not q:
        return JsonResponse({"ok": True, **res})
    low = q.lower()
    for f in p.features.all()[:MAX_FEATURES]:
        if low in (f.name or "").lower() or low == f.category or low in (f.notes or "").lower():
            res["features"].append({"id": str(f.id), "name": f.name, "category": f.category, "centroid": [f.centroid_lat, f.centroid_lng]})
            if len(res["features"]) >= 20:
                break
    norm = geo.normalise_location_id(q)
    for r in LocationRecord.objects.filter(project=p):
        if norm == r.code or low in r.label.lower() or low in r.holder_name.lower() or low.upper() == r.plus_code:
            res["records"].append({"id": str(r.id), "code": r.code, "label": r.label, "holder": r.holder_name,
                                   "centroid": [r.centroid_lat, r.centroid_lng], "feature_id": str(r.feature_id) if r.feature_id else None})
    if geo.location_id_valid(norm) and not res["records"]:
        other = LocationRecord.objects.filter(code=norm).first()
        if other:
            res["records"].append({"id": str(other.id), "code": other.code, "label": other.label, "external": True,
                                   "centroid": [other.centroid_lat, other.centroid_lng],
                                   "verify": reverse("kura_geo:verify", args=[other.code])})
    if request.GET.get("places", "1") == "1" and not res["records"]:
        res["places"] = ai.geocode(q, near=(p.center_lat, p.center_lng))
    return JsonResponse({"ok": True, **res})


def _import_survey(p, survey, user):
    items = services.survey_layers(survey)
    made = []
    for it in items[:MAX_FEATURES - p.features.count()]:
        f = Feature(project=p, created_by=user)
        try:
            _apply_feature(f, it)
        except ValueError:
            continue
        made.append(f)
    Feature.objects.bulk_create(made, batch_size=500)
    return made


def a_import_survey(request, p, oid):
    from kura.models import Survey
    code = str(_body(request).get("code") or "").upper()
    s = get_object_or_404(Survey, code=code, owner=request.user)
    made = _import_survey(p, s, request.user)
    return JsonResponse({"ok": True, "created": len(made), "features": [f.as_dict() for f in made]})


def a_import_file(request, p, oid):
    """GeoJSON (FeatureCollection / Feature / geometry) upload or paste."""
    raw = None
    if request.FILES.get("file"):
        raw = request.FILES["file"].read(8 * 1024 * 1024 + 1).decode("utf-8", "ignore")
    else:
        raw = request.body.decode("utf-8", "ignore")
    try:
        data = json.loads(raw)
    except ValueError:
        return _err("That isn't valid GeoJSON.")
    feats = data.get("features") if data.get("type") == "FeatureCollection" else (
        [data] if data.get("type") == "Feature" else [{"type": "Feature", "geometry": data, "properties": {}}])
    made = []
    layer = (request.GET.get("layer") or "Imported")[:80]
    for ft in (feats or [])[:3000]:
        g = (ft or {}).get("geometry")
        if not geo.valid_geometry(g):
            continue
        pr = ft.get("properties") or {}
        f = Feature(project=p, created_by=request.user, layer=layer)
        try:
            _apply_feature(f, {"geometry": g, "name": pr.get("name") or pr.get("Name") or pr.get("label") or "",
                               "properties": {"radius": pr.get("radius") or pr.get("radius_m"),
                                              "fields": {k: v for k, v in pr.items() if isinstance(v, (str, int, float))}},
                               "style": {"color": pr.get("stroke") or pr.get("color"), "fillColor": pr.get("fill")}})
        except ValueError:
            continue
        made.append(f)
    Feature.objects.bulk_create(made, batch_size=500)
    return JsonResponse({"ok": True, "created": len(made), "features": [f.as_dict() for f in made]})


def a_export(request, p, oid):
    fmt = request.GET.get("format", "geojson")
    feats = p.features.all()
    if fmt == "kml":
        return _kml(p, feats)
    if fmt == "csv":
        import csv
        import io
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["id", "name", "category", "layer", "geometry_type", "hectares", "length_m", "centroid_lat",
                    "centroid_lng", "plus_code", "location_ids", "geofence"])
        recs = {}
        for r in p.records.all():
            recs.setdefault(str(r.feature_id), []).append(r.code)
        for f in feats:
            w.writerow([f.id, f.name, f.category, f.layer, f.geometry.get("type"), round(f.hectares, 4),
                        round(f.length_m, 1), f.centroid_lat, f.centroid_lng,
                        geo.plus_code(f.centroid_lat, f.centroid_lng) if f.centroid_lat is not None else "",
                        " ".join(recs.get(str(f.id), [])), f.is_geofence])
        resp = HttpResponse(buf.getvalue(), content_type="text/csv")
        resp["Content-Disposition"] = f'attachment; filename="geo_{str(p.id)[:8]}.csv"'
        return resp
    recs = {}
    for r in p.records.all():
        recs.setdefault(str(r.feature_id), []).append(r.code)
    out = {"type": "FeatureCollection", "name": p.title, "features": []}
    for f in feats:
        g = f.geometry
        if g.get("type") == "Point" and f.properties.get("radius") and request.GET.get("circles") != "points":
            g = geo.circle_polygon(g["coordinates"][0], g["coordinates"][1], float(f.properties["radius"]))
        props = {"id": str(f.id), "name": f.name, "category": f.category, "layer": f.layer,
                 "hectares": round(f.hectares, 4), "length_m": round(f.length_m, 1), "geofence": f.is_geofence,
                 "location_ids": recs.get(str(f.id), []), "stroke": f.style.get("color"),
                 "fill": f.style.get("fillColor") or f.style.get("color"), **f.properties}
        out["features"].append({"type": "Feature", "geometry": g, "properties": props})
    resp = JsonResponse(out)
    resp["Content-Disposition"] = f'attachment; filename="geo_{str(p.id)[:8]}.geojson"'
    return resp


def _kml(p, feats):
    from xml.sax.saxutils import escape

    def coords(ring):
        return " ".join(f"{c[0]},{c[1]},0" for c in ring)

    def kcol(hexc, alpha="ff"):
        h = (hexc or "#22d3ee").lstrip("#")[:6].ljust(6, "0")
        return alpha + h[4:6] + h[2:4] + h[0:2]

    parts = ['<?xml version="1.0" encoding="UTF-8"?>', '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>',
             f"<name>{escape(p.title)}</name>"]
    for f in feats:
        g = f.geometry
        if g.get("type") == "Point" and f.properties.get("radius"):
            g = geo.circle_polygon(g["coordinates"][0], g["coordinates"][1], float(f.properties["radius"]))
        c = f.style.get("color")
        st = (f"<Style><LineStyle><color>{kcol(c)}</color><width>2</width></LineStyle>"
              f"<PolyStyle><color>{kcol(f.style.get('fillColor') or c, '55')}</color></PolyStyle></Style>")
        desc = escape(f"{f.get_category_display()} · {f.hectares:.4f} ha")
        body = ""
        t = g.get("type")
        if t == "Point":
            body = f"<Point><coordinates>{g['coordinates'][0]},{g['coordinates'][1]},0</coordinates></Point>"
        elif t == "LineString":
            body = f"<LineString><coordinates>{coords(g['coordinates'])}</coordinates></LineString>"
        elif t in ("Polygon", "MultiPolygon"):
            polys = [g["coordinates"]] if t == "Polygon" else g["coordinates"]
            ps = []
            for poly in polys:
                inner = "".join(f"<innerBoundaryIs><LinearRing><coordinates>{coords(h)}</coordinates></LinearRing></innerBoundaryIs>" for h in poly[1:])
                ps.append(f"<Polygon><outerBoundaryIs><LinearRing><coordinates>{coords(poly[0])}</coordinates></LinearRing></outerBoundaryIs>{inner}</Polygon>")
            body = ps[0] if len(ps) == 1 else "<MultiGeometry>" + "".join(ps) + "</MultiGeometry>"
        if body:
            parts.append(f"<Placemark><name>{escape(f.name or f.get_category_display())}</name><description>{desc}</description>{st}{body}</Placemark>")
    parts.append("</Document></kml>")
    resp = HttpResponse("".join(parts), content_type="application/vnd.google-earth.kml+xml")
    resp["Content-Disposition"] = f'attachment; filename="geo_{str(p.id)[:8]}.kml"'
    return resp


API = {
    "state": ("GET", a_state),
    "project": ("POST", a_project),
    "feature": ("POST", a_feature_save),
    "features-bulk": ("POST", a_feature_bulk),
    "feature-delete": ("POST", a_feature_delete),
    "layer": ("POST", a_layer),
    "analyze": ("POST", a_analyze),
    "analysis": ("ANY", a_analysis),
    "fit": ("POST", a_fit),
    "analysis-features": ("POST", a_detections_to_features),
    "register": ("POST", a_register),
    "record": ("ANY", a_record),
    "overlap": ("POST", a_check_overlap),
    "asset": ("POST", a_asset),
    "tracker": ("POST", a_tracker),
    "geofence-check": ("GET", a_geofence_check),
    "imagery": ("POST", a_imagery),
    "ai": ("POST", a_ai),
    "search": ("GET", a_search),
    "import-survey": ("POST", a_import_survey),
    "import-file": ("POST", a_import_file),
    "export": ("GET", a_export),
}
