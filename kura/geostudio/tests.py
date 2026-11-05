"""
Kura Geo Studio tests —  python manage.py test kura.geostudio
"""

import json
import math
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from . import ai, carbon, detect, geo, imagery, services
from .models import Feature, GeoProject, LocationRecord, Tracker

# ≈ 100 m × 100 m square near Banjul (≈ 1 ha)
D = 100 / 111320.0
SQ = {"type": "Polygon", "coordinates": [[[-16.58, 13.45], [-16.58 + D / math.cos(math.radians(13.45)), 13.45],
                                          [-16.58 + D / math.cos(math.radians(13.45)), 13.45 + D],
                                          [-16.58, 13.45 + D], [-16.58, 13.45]]]}


class GeometryTests(TestCase):
    def test_area_one_hectare(self):
        self.assertAlmostEqual(geo.area_m2(SQ) / 10000, 1.0, delta=0.01)

    def test_circle_area(self):
        c = geo.circle_polygon(-16.58, 13.45, 100, steps=256)
        self.assertAlmostEqual(geo.area_m2(c), math.pi * 100 ** 2, delta=60)

    def test_point_in(self):
        c = geo.centroid(SQ)
        self.assertTrue(geo.point_in_geometry(c[0], c[1], SQ))
        self.assertFalse(geo.point_in_geometry(-16.0, 13.0, SQ))
        self.assertTrue(geo.point_in_geometry(-16.58, 13.45, {"type": "Point", "coordinates": [-16.5801, 13.4501]}, {"radius": 50}))

    def test_overlap(self):
        shifted = json.loads(json.dumps(SQ))
        for p in shifted["coordinates"][0]:
            p[0] += D * 0.5
        far = json.loads(json.dumps(SQ))
        for p in far["coordinates"][0]:
            p[0] += 1
        self.assertTrue(geo.polygons_overlap(SQ, shifted))
        self.assertFalse(geo.polygons_overlap(SQ, far))

    def test_hash_independent_of_start_and_direction(self):
        ring = SQ["coordinates"][0][:-1]
        rot = ring[2:] + ring[:2]
        rev = list(reversed(ring))
        a = geo.geometry_hash(SQ)
        self.assertEqual(a, geo.geometry_hash({"type": "Polygon", "coordinates": [rot + [rot[0]]]}))
        self.assertEqual(a, geo.geometry_hash({"type": "Polygon", "coordinates": [rev + [rev[0]]]}))
        moved = json.loads(json.dumps(SQ))
        moved["coordinates"][0][1][0] += 0.00001
        self.assertNotEqual(a, geo.geometry_hash(moved))

    def test_location_id_check_char(self):
        code = geo.make_location_id(geo.geometry_hash(SQ), "GM")
        self.assertRegex(code, r"^GM-[0-9A-Z]{4}-[0-9A-Z]{4}-.$")
        self.assertTrue(geo.location_id_valid(code))
        self.assertTrue(geo.location_id_valid(code.lower()))
        body = code[3]
        typo = code[:3] + ("1" if body != "1" else "2") + code[4:]
        self.assertFalse(geo.location_id_valid(typo))

    def test_plus_code_known(self):
        # Google HQ reference from the OLC spec tests
        self.assertEqual(geo.plus_code(37.4220, -122.0841), "849VCWC8+R9")

    def test_mercator_roundtrip(self):
        x, y = geo.lonlat_to_pixel(-16.58, 13.45, 18)
        lon, lat = geo.pixel_to_lonlat(x, y, 18)
        self.assertAlmostEqual(lon, -16.58, places=6)
        self.assertAlmostEqual(lat, 13.45, places=6)


class CarbonTests(TestCase):
    def test_mangrove(self):
        e = carbon.estimate("mangrove", 10, years=2, canopy_fraction=0.5)
        self.assertAlmostEqual(e["gross_tco2e"], 10 * 0.5 * 6.4 * 2, places=2)
        self.assertEqual(e["credits"], int(e["gross_tco2e"] * 0.8))

    def test_solar(self):
        e = carbon.estimate("solar", 0, years=1, panel_area_m2=1000)
        self.assertEqual(e["kwp"], 200)
        self.assertAlmostEqual(e["mwh_yr"], 200 * 1650 * 0.8 / 1000, places=1)


class ParserTests(TestCase):
    def test_draw_hectares(self):
        a = ai.builtin("draw a 5 hectare circle at Brikama called Nursery", {})[0]
        self.assertEqual(a["type"], "draw")
        self.assertEqual(a["shape"], "circle")
        self.assertAlmostEqual(a["radius_m"], math.sqrt(50000 / math.pi), places=3)
        self.assertEqual(a["place"], "Brikama")
        self.assertEqual(a["name"], "Nursery")

    def test_count_trees(self):
        self.assertEqual(ai.builtin("count the palm trees here", {})[0]["type"], "analyze")
        self.assertEqual(ai.builtin("find solar panels in view", {})[0]["kind"], "solar")

    def test_colour(self):
        a = ai.builtin("colour all mangroves dark green", {})[0]
        self.assertEqual(a, {"type": "style", "filter": {"category": "mangrove"},
                             "style": {"color": "#15803d", "fillColor": "#15803d"}})

    def test_select(self):
        a = ai.builtin("show parcels bigger than 2 ha", {})[0]
        self.assertEqual(a["filter"], {"category": "parcel", "min_ha": 2.0})

    def test_coords_and_goto(self):
        self.assertEqual(ai.builtin("13.45, -16.57", {})[0]["type"], "fly_to")
        self.assertEqual(ai.builtin("go to Tanji", {})[0], {"type": "geocode", "query": "Tanji"})


class RegistryTests(TestCase):
    def setUp(self):
        self.u = get_user_model().objects.create_user("foon", password="x")
        self.p = GeoProject.objects.create(owner=self.u, title="Land")
        self.f = Feature(project=self.p, geometry=SQ, name="Plot A")
        self.f.remeasure()
        self.f.save()

    def test_register_and_chain(self):
        r = services.register(self.p, self.f, self.u, holder_name="Awa Jallow Ceesay", tenure="leasehold")
        self.assertTrue(geo.location_id_valid(r.code))
        services.add_event(r, "transfer", self.u, party="Lamin Sowe")
        services.add_event(r, "verify", self.u, note="Walked boundary")
        r.refresh_from_db()
        self.assertEqual(r.holder_name, "Lamin Sowe")
        self.assertEqual(r.status, "verified")
        self.assertTrue(services.verify_chain(r)["ok"])
        # tamper with history
        ev = r.events.get(seq=2)
        ev.party_name = "Someone Else"
        ev.save()
        v = services.verify_chain(r)
        self.assertFalse(v["ok"])
        self.assertEqual(v["broken_at"], 2)
        self.assertEqual(r.as_dict(private=False)["holder_name"], "Lamin S***")

    def test_overlap_refused(self):
        services.register(self.p, self.f, self.u)
        g = json.loads(json.dumps(SQ))
        for pt in g["coordinates"][0]:
            pt[1] += D * 0.3
        f2 = Feature(project=self.p, geometry=g)
        f2.remeasure()
        f2.save()
        with self.assertRaises(services.RegistryError):
            services.register(self.p, f2, self.u)
        r2 = services.register(self.p, f2, self.u, allow_overlap=True)
        self.assertTrue(r2.events.first().details["overlaps"])

    def test_same_boundary_refused(self):
        services.register(self.p, self.f, self.u)
        f2 = Feature(project=self.p, geometry=SQ)
        f2.remeasure()
        f2.save()
        with self.assertRaises(services.RegistryError):
            services.register(self.p, f2, self.u)


class TrackingTests(TestCase):
    def test_enter_exit(self):
        u = get_user_model().objects.create_user("t", password="x")
        p = GeoProject.objects.create(owner=u)
        f = Feature(project=p, geometry=SQ, is_geofence=True, name="Depot")
        f.remeasure()
        f.save()
        t = Tracker.objects.create(project=p, name="Truck")
        c = geo.centroid(SQ)
        _, ev = services.track(t, c[1], c[0])
        self.assertEqual([e.kind for e in ev], ["enter"])
        _, ev = services.track(t, c[1], c[0])
        self.assertEqual(ev, [])
        _, ev = services.track(t, 13.0, -16.0)
        self.assertEqual([e.kind for e in ev], ["exit"])


class PixelEngineTests(TestCase):
    def _frame(self):
        import numpy as np
        from PIL import Image
        h = w = 400
        arr = np.zeros((h, w, 3), dtype=np.uint8)
        arr[:] = (190, 170, 140)                      # sandy ground
        rng = np.random.default_rng(1)
        yy, xx = np.mgrid[0:h, 0:w]
        centres = [(y, x) for y in range(30, 200, 40) for x in range(30, 380, 40)]  # 5 × 9 = 45 crowns
        for cy, cx in centres:
            arr[(yy - cy) ** 2 + (xx - cx) ** 2 < 9 ** 2] = (40, 120, 40)
        arr[260:300, 60:180] = (25, 35, 60)           # one 40×120 px solar array
        arr += rng.integers(0, 6, arr.shape, dtype=np.uint8)
        img = Image.fromarray(arr)
        # place it so that 1 px ≈ 0.5 m
        z = 18
        x0, y0 = geo.lonlat_to_pixel(-16.6, 13.46, z)
        s = 256 * 2 ** z
        k = 0.5 / geo.metres_per_pixel(13.46, z)
        return imagery.Frame(img, x0 / s, y0 / s, (x0 + w * k) / s, (y0 + h * k) / s, source="test", zoom=z), centres

    def test_counts(self):
        import numpy as np
        frame, centres = self._frame()
        mask = np.ones((400, 400), dtype=bool)
        out, dets, _ = detect.pixel_engine(frame, mask, "full")
        self.assertAlmostEqual(out["metres_per_pixel"], 0.5, delta=0.02)
        self.assertGreaterEqual(out["tree_count"], 40)
        self.assertLessEqual(out["tree_count"], 50)
        self.assertEqual(out["solar_count"], 1)
        self.assertAlmostEqual(out["solar_area_m2"], 40 * 120 * 0.25, delta=150)
        self.assertGreater(out["landcover_pct"]["canopy"], 5)

    def test_hybrid_survives_ai_failure(self):
        frame, _ = self._frame()
        w, n = frame.to_lonlat(0, 0)
        e, s = frame.to_lonlat(400, 400)
        aoi = {"type": "Polygon", "coordinates": [[[w, s], [e, s], [e, n], [w, n], [w, s]]]}
        with mock.patch.object(detect, "ai_engine", side_effect=RuntimeError("no key")):
            res, overlay, snap = detect.run(frame, aoi, kind="full", engine="hybrid")
        self.assertIn("ai_error", res)
        self.assertTrue(res["summary"]["tree_count"] >= 40)
        self.assertEqual(len(res["snapshot_sha256"]), 64)
        self.assertTrue(overlay.startswith(b"\x89PNG"))


@override_settings(STORAGES={
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
})
class ApiTests(TestCase):
    def setUp(self):
        self.u = get_user_model().objects.create_user("foon", password="x")
        self.client.force_login(self.u)
        self.p = GeoProject.objects.create(owner=self.u)
        self.base = f"/kura/geo/p/{self.p.id}/api/"

    def post(self, action, data, oid=None):
        url = self.base + action + "/" + (f"{oid}/" if oid else "")
        return self.client.post(url, json.dumps(data), content_type="application/json").json()

    def test_flow(self):
        r = self.post("feature", {"geometry": SQ, "name": "Mangrove block", "category": "mangrove",
                                  "style": {"color": "#10b981", "evil": "x"}})
        self.assertTrue(r["ok"])
        fid = r["feature"]["id"]
        self.assertAlmostEqual(r["feature"]["area_m2"] / 1e4, 1, delta=0.01)
        self.assertNotIn("evil", r["feature"]["style"])
        a = self.post("asset", {"feature_id": fid, "ecosystem": "mangrove", "claimed_hectares": 1.2,
                                "claimed_trees": 3000, "planted_on": "2025-06-01"})
        self.assertTrue(a["ok"])
        self.assertLess(a["asset"]["verification"]["hectares_diff_pct"], 0)
        reg = self.post("register", {"feature_id": fid, "holder_name": "Kartong Community"})
        self.assertTrue(reg["ok"])
        code = reg["record"]["code"]
        self.assertEqual(self.client.get(f"/kura/geo/id/{code}/").status_code, 200)
        self.assertTrue(self.client.get(f"/kura/geo/lookup/{code}.json").json()["record"]["chain"]["ok"])
        st = self.client.get(self.base + "state/").json()
        self.assertEqual(len(st["features"]), 1)
        self.assertEqual(self.client.get(f"/kura/geo/p/{self.p.id}/").status_code, 200)
        self.assertEqual(self.client.get(f"/kura/geo/p/{self.p.id}/report/").status_code, 200)
        self.assertEqual(self.client.get("/kura/geo/").status_code, 200)
        geojson = self.client.get(self.base + "export/?format=geojson").json()
        self.assertEqual(geojson["features"][0]["properties"]["location_ids"], [code])
        self.assertIn(b"<kml", self.client.get(self.base + "export/?format=kml").content)
        # registered features can't be deleted
        self.assertFalse(self.post("feature-delete", {}, fid)["ok"])

    def test_tracker_ping_and_public_report(self):
        f = self.post("feature", {"geometry": SQ, "category": "geofence", "name": "Nursery"})
        t = self.post("tracker", {"name": "Ranger"})["tracker"]
        self.assertEqual(self.client.get(f"/kura/geo/t/{t['token']}/").status_code, 200)
        c = geo.centroid(SQ)
        from django.test import Client
        phone = Client(enforce_csrf_checks=True)          # a phone has no session or CSRF cookie
        r = phone.post(f"/kura/geo/t/{t['token']}/ping/", json.dumps({"lat": c[1], "lng": c[0]}),
                       content_type="application/json").json()
        self.assertEqual(r["inside"], ["Nursery"])
        self.assertEqual(r["events"][0]["kind"], "enter")
        self.assertEqual(self.client.get(f"/kura/geo/r/{self.p.share_token}/").status_code, 404)
        self.post("project", {"is_public": True})
        self.assertEqual(self.client.get(f"/kura/geo/r/{self.p.share_token}/").status_code, 200)

    def test_other_user_blocked(self):
        other = get_user_model().objects.create_user("x", password="x")
        self.client.force_login(other)
        self.assertEqual(self.client.get(self.base + "state/").status_code, 404)

    def test_ai_builtin(self):
        r = self.post("ai", {"message": "draw a 2 ha circle", "ai": False})
        self.assertEqual(r["actions"][0]["type"], "draw")


class AiVisionTests(TestCase):
    def test_boxes_become_coordinates(self):
        frame, _ = PixelEngineTests()._frame()
        import numpy as np
        mask = np.ones((400, 400), dtype=bool)
        reply = {"candidates": [{"content": {"parts": [{"text": json.dumps({
            "detections": [{"label": "palm tree", "box_2d": [50, 50, 100, 100], "confidence": 0.9},
                           {"label": "solar panel", "box_2d": [650, 150, 750, 450], "confidence": 0.8}],
            "landcover": {"tree_canopy_pct": 30}, "notes": "Young palm rows."})}]}}]}
        from hanns import ai as hai
        with mock.patch.object(hai, "is_enabled", return_value=True), \
                mock.patch.object(hai, "model_chain", return_value=["m1"]), \
                mock.patch.object(hai, "_post", return_value=(200, reply)):
            res, dets = detect.ai_engine(frame, mask, "full")
        self.assertEqual(res["counts"], {"palm": 1, "solar": 1})
        palm = dets[0]
        lon, lat = frame.to_lonlat(30, 30)       # centre of the 50..100/1000 box on a 400 px frame
        self.assertAlmostEqual(palm["lng"], lon, places=6)
        self.assertAlmostEqual(palm["lat"], lat, places=6)
        self.assertAlmostEqual(dets[1]["area_m2"], (120 * 0.5) * (40 * 0.5), delta=30)
