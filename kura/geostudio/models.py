"""
kura/geostudio/models.py — Kura Geo Studio: AI-assisted mapping, MRV and land registry.

    GeoProject      one map workspace (a carbon project, a land allocation
                    exercise, a solar audit, a field campaign…)
    Feature         anything drawn: polygon, line, point, circle, text, icon.
                    Geometry is plain GeoJSON in WGS84, style is JSON — no GIS
                    extension needed in Postgres.
    ImageryLayer    a drone / orthophoto image pinned to map bounds; can be
                    analysed instead of satellite tiles
    Analysis        one run of tree / solar / land-cover detection over an
                    area of interest, with its result and overlay frozen
    CarbonAsset     an ecosystem claim on a feature (mangrove, palm…) that
                    analyses are compared against over time — the MRV record
    LocationRecord  a registered Location ID (GM-7K3Q-9XA2-M) for a parcel or
                    place — the land allocation / ownership register
    LandEvent       append-only, hash-chained history of a LocationRecord
                    (allocation, transfer, verification, dispute…). Editing
                    any past row breaks the chain and verification says so.
    Tracker         a phone/device sharing live GPS into the project
    TrackPoint      its breadcrumb trail
    GeofenceEvent   enter / exit of a geofence feature
"""

import secrets
import uuid

from django.conf import settings
from django.db import models


def _token():
    return secrets.token_urlsafe(16)


class GeoProject(models.Model):
    PURPOSES = [
        ("general", "General mapping"),
        ("carbon", "Carbon / restoration MRV"),
        ("land", "Land allocation & ownership"),
        ("solar", "Solar survey"),
        ("forestry", "Forestry & agriculture"),
        ("security", "Geofencing & tracking"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="geo_projects")
    title = models.CharField(max_length=160, default="Untitled map")
    description = models.TextField(blank=True)
    purpose = models.CharField(max_length=20, choices=PURPOSES, default="general")
    center_lat = models.FloatField(default=13.4549)     # Banjul
    center_lng = models.FloatField(default=-16.5790)
    zoom = models.PositiveSmallIntegerField(default=13)
    basemap = models.CharField(max_length=20, default="satellite")
    # Optional home survey: its GPS points, mapper answers and zones can be
    # pulled into the studio as layers (more can be imported ad hoc).
    survey = models.ForeignKey("kura.Survey", null=True, blank=True, on_delete=models.SET_NULL,
                               related_name="geo_projects")
    share_token = models.CharField(max_length=40, unique=True, default=_token)
    is_public = models.BooleanField(default=False, help_text="Public MRV report link is live")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return self.title

    def can_edit(self, user):
        return bool(user and user.is_authenticated and (user.id == self.owner_id or user.is_superuser))


class Feature(models.Model):
    CATEGORIES = [
        ("none", "Unclassified"),
        ("parcel", "Land parcel"),
        ("geofence", "Geofence"),
        ("aoi", "Area of interest"),
        ("mangrove", "Mangrove"),
        ("palm", "Palm trees"),
        ("forest", "Forest"),
        ("agroforestry", "Agroforestry"),
        ("cashew", "Cashew / orchard"),
        ("farm", "Farm / cropland"),
        ("solar", "Solar installation"),
        ("building", "Building"),
        ("road", "Road / track"),
        ("water", "Water body"),
        ("plot", "Sample plot"),
        ("poi", "Point of interest"),
        ("note", "Annotation"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(GeoProject, on_delete=models.CASCADE, related_name="features")
    name = models.CharField(max_length=160, blank=True)
    category = models.CharField(max_length=20, choices=CATEGORIES, default="none")
    layer = models.CharField(max_length=80, default="Main")
    geometry = models.JSONField()
    # radius (circles), text (labels), icon (markers), shape hint, custom fields
    properties = models.JSONField(default=dict, blank=True)
    style = models.JSONField(default=dict, blank=True)
    notes = models.TextField(blank=True)
    is_geofence = models.BooleanField(default=False)
    locked = models.BooleanField(default=False)
    hidden = models.BooleanField(default=False)
    z_index = models.IntegerField(default=0)
    area_m2 = models.FloatField(default=0)
    length_m = models.FloatField(default=0)
    centroid_lat = models.FloatField(null=True, blank=True)
    centroid_lng = models.FloatField(null=True, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["z_index", "created_at"]

    def __str__(self):
        return self.name or f"{self.get_category_display()} {str(self.id)[:6]}"

    def remeasure(self):
        from . import geo
        m = geo.measure(self.geometry, self.properties)
        self.area_m2 = round(m["area_m2"], 3)
        self.length_m = round(m["length_m"], 3)
        if m["centroid"]:
            self.centroid_lng, self.centroid_lat = m["centroid"]

    @property
    def hectares(self):
        return self.area_m2 / 10000.0

    def as_dict(self):
        return {
            "id": str(self.id), "name": self.name, "category": self.category, "layer": self.layer,
            "geometry": self.geometry, "properties": self.properties, "style": self.style,
            "notes": self.notes, "is_geofence": self.is_geofence, "locked": self.locked,
            "hidden": self.hidden, "z": self.z_index, "area_m2": self.area_m2, "length_m": self.length_m,
            "centroid": [self.centroid_lat, self.centroid_lng] if self.centroid_lat is not None else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class ImageryLayer(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(GeoProject, on_delete=models.CASCADE, related_name="imagery")
    name = models.CharField(max_length=160, default="Drone image")
    file = models.FileField(upload_to="geostudio/imagery/")
    bounds = models.JSONField(help_text="[west, south, east, north]")
    captured_on = models.DateField(null=True, blank=True)
    opacity = models.FloatField(default=1.0)
    created_at = models.DateTimeField(auto_now_add=True)

    def as_dict(self):
        return {"id": str(self.id), "name": self.name, "url": self.file.url if self.file else "",
                "bounds": self.bounds, "opacity": self.opacity,
                "captured_on": self.captured_on.isoformat() if self.captured_on else None}


class Analysis(models.Model):
    KINDS = [("trees", "Trees & canopy"), ("solar", "Solar panels"), ("landcover", "Land cover"), ("full", "Everything")]
    ENGINES = [("pixel", "Pixel engine (offline)"), ("ai", "AI vision"), ("hybrid", "Hybrid")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(GeoProject, on_delete=models.CASCADE, related_name="analyses")
    feature = models.ForeignKey(Feature, null=True, blank=True, on_delete=models.SET_NULL, related_name="analyses")
    imagery = models.ForeignKey(ImageryLayer, null=True, blank=True, on_delete=models.SET_NULL)
    kind = models.CharField(max_length=12, choices=KINDS, default="full")
    engine = models.CharField(max_length=8, choices=ENGINES, default="hybrid")
    zoom = models.PositiveSmallIntegerField(default=18)
    aoi = models.JSONField(help_text="GeoJSON geometry analysed (frozen copy)")
    result = models.JSONField(default=dict, blank=True)
    overlay = models.FileField(upload_to="geostudio/analyses/", blank=True)
    snapshot = models.FileField(upload_to="geostudio/snapshots/", blank=True)
    snapshot_sha256 = models.CharField(max_length=64, blank=True)
    bounds = models.JSONField(default=list, blank=True)
    status = models.CharField(max_length=12, default="done")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name_plural = "analyses"

    def as_dict(self, full=True):
        d = {
            "id": str(self.id), "feature_id": str(self.feature_id) if self.feature_id else None,
            "kind": self.kind, "engine": self.engine, "zoom": self.zoom, "status": self.status,
            "bounds": self.bounds, "overlay": self.overlay.url if self.overlay else "",
            "snapshot": self.snapshot.url if self.snapshot else "", "sha256": self.snapshot_sha256,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "summary": (self.result or {}).get("summary", {}),
        }
        if full:
            d["result"] = self.result
            d["aoi"] = self.aoi
        return d


class CarbonAsset(models.Model):
    STATUSES = [("planning", "Planning"), ("monitoring", "Monitoring"), ("validated", "Validated"),
                ("verified", "Verified"), ("issued", "Credits issued")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(GeoProject, on_delete=models.CASCADE, related_name="carbon_assets")
    feature = models.ForeignKey(Feature, on_delete=models.CASCADE, related_name="carbon_assets")
    ecosystem = models.CharField(max_length=20, default="mangrove")
    planted_on = models.DateField(null=True, blank=True)
    claimed_trees = models.PositiveIntegerField(default=0)
    claimed_hectares = models.FloatField(default=0)
    overrides = models.JSONField(default=dict, blank=True)
    price_usd = models.FloatField(null=True, blank=True)
    status = models.CharField(max_length=12, choices=STATUSES, default="planning")
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at"]


class LocationRecord(models.Model):
    TENURES = [("customary", "Customary"), ("leasehold", "Leasehold"), ("freehold", "Freehold"),
               ("state", "State land"), ("community", "Community land"), ("allocation", "Allocation / permit"),
               ("other", "Other")]
    STATUSES = [("draft", "Draft"), ("registered", "Registered"), ("verified", "Verified"),
                ("disputed", "Disputed"), ("retired", "Retired")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(GeoProject, on_delete=models.CASCADE, related_name="records")
    feature = models.ForeignKey(Feature, null=True, blank=True, on_delete=models.SET_NULL, related_name="records")
    parent = models.ForeignKey("self", null=True, blank=True, on_delete=models.SET_NULL, related_name="children")
    code = models.CharField(max_length=40, unique=True)
    geometry_hash = models.CharField(max_length=64, db_index=True)
    geometry = models.JSONField(help_text="Frozen boundary at registration")
    geometry_props = models.JSONField(default=dict, blank=True)
    plus_code = models.CharField(max_length=16, blank=True)
    centroid_lat = models.FloatField()
    centroid_lng = models.FloatField()
    area_m2 = models.FloatField(default=0)
    label = models.CharField(max_length=160, blank=True)
    holder_name = models.CharField(max_length=160, blank=True)
    holder_contact = models.CharField(max_length=160, blank=True)
    tenure = models.CharField(max_length=12, choices=TENURES, default="customary")
    land_use = models.CharField(max_length=80, blank=True)
    status = models.CharField(max_length=12, choices=STATUSES, default="registered")
    head_hash = models.CharField(max_length=64, blank=True)
    registered_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.code

    def as_dict(self, private=True):
        d = {
            "id": str(self.id), "code": self.code, "hash": self.geometry_hash, "plus_code": self.plus_code,
            "centroid": [self.centroid_lat, self.centroid_lng], "area_m2": self.area_m2,
            "hectares": round(self.area_m2 / 10000.0, 4), "label": self.label,
            "tenure": self.tenure, "tenure_label": self.get_tenure_display(), "land_use": self.land_use,
            "status": self.status, "status_label": self.get_status_display(),
            "feature_id": str(self.feature_id) if self.feature_id else None,
            "parent": self.parent.code if self.parent_id else None, "head_hash": self.head_hash,
            "geometry": self.geometry, "geometry_props": self.geometry_props,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
        d["holder_name"] = self.holder_name if private else _mask(self.holder_name)
        if private:
            d["holder_contact"] = self.holder_contact
        return d


def _mask(name):
    """Public pages show 'Awa J*** C***' — enough to recognise, not to harvest."""
    parts = (name or "").split()
    if not parts:
        return ""
    return " ".join([parts[0]] + [p[0] + "***" for p in parts[1:]])


class LandEvent(models.Model):
    KINDS = [("register", "Registered"), ("allocate", "Allocated"), ("transfer", "Transferred"),
             ("verify", "Field-verified"), ("survey", "Re-surveyed"), ("dispute", "Dispute raised"),
             ("resolve", "Dispute resolved"), ("subdivide", "Subdivided"), ("lease", "Leased"),
             ("retire", "Retired"), ("note", "Note")]

    record = models.ForeignKey(LocationRecord, on_delete=models.CASCADE, related_name="events")
    seq = models.PositiveIntegerField()
    kind = models.CharField(max_length=12, choices=KINDS)
    party_name = models.CharField(max_length=160, blank=True)
    details = models.JSONField(default=dict, blank=True)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    actor_name = models.CharField(max_length=160, blank=True)
    prev_hash = models.CharField(max_length=64, blank=True)
    hash = models.CharField(max_length=64)
    created_at = models.DateTimeField()

    class Meta:
        ordering = ["record", "seq"]
        constraints = [models.UniqueConstraint(fields=["record", "seq"], name="geo_landevent_seq_unique")]

    def payload(self):
        """Exactly what is hashed. Never add a field here without a chain
        version bump — old rows would stop verifying."""
        return {"record": self.record.code, "seq": self.seq, "kind": self.kind, "party": self.party_name,
                "details": self.details, "actor": self.actor_name,
                "at": self.created_at.isoformat(timespec="seconds")}


class Tracker(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(GeoProject, on_delete=models.CASCADE, related_name="trackers")
    name = models.CharField(max_length=80)
    token = models.CharField(max_length=40, unique=True, default=_token)
    color = models.CharField(max_length=9, default="#f59e0b")
    active = models.BooleanField(default=True)
    last_lat = models.FloatField(null=True, blank=True)
    last_lng = models.FloatField(null=True, blank=True)
    last_acc = models.FloatField(null=True, blank=True)
    last_seen = models.DateTimeField(null=True, blank=True)
    inside = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def as_dict(self):
        return {"id": str(self.id), "name": self.name, "token": self.token, "color": self.color,
                "active": self.active, "lat": self.last_lat, "lng": self.last_lng, "acc": self.last_acc,
                "last_seen": self.last_seen.isoformat() if self.last_seen else None, "inside": self.inside}


class TrackPoint(models.Model):
    tracker = models.ForeignKey(Tracker, on_delete=models.CASCADE, related_name="points")
    lat = models.FloatField()
    lng = models.FloatField()
    acc = models.FloatField(null=True, blank=True)
    speed = models.FloatField(null=True, blank=True)
    at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["at"]


class GeofenceEvent(models.Model):
    tracker = models.ForeignKey(Tracker, on_delete=models.CASCADE, related_name="fence_events")
    feature = models.ForeignKey(Feature, on_delete=models.CASCADE, related_name="fence_events")
    kind = models.CharField(max_length=6, choices=[("enter", "Entered"), ("exit", "Exited")])
    lat = models.FloatField()
    lng = models.FloatField()
    at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-at"]
